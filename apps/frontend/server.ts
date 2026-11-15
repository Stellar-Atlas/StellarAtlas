import dotenv from "dotenv";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { rewriteApiDocsHtml } from "./api-docs-proxy.js";
import { compatibilityRedirect, InvalidProxyPath, proxyRequest } from "./proxy-transport.js";

const defaultPort = 3000;
const assetCacheTimeMs = 86_400_000 * 7;
const apiDocsPathPattern = /^\/api-docs(?:\/|$)/;
const apiPathPattern = /^\/v1(?:\/|$)/;
const graphqlPathPattern = /^\/graphql(?:\/|$)/;
const assetPathPattern = /^\/(assets|css|js|img|fonts)\/.+/;
const legacyPathPattern = /^\/legacy(?:\/|$)/;
const modernCompatibilityPathPattern = /^\/new-ui(?:\/|$)/;
const modernFrontendPathPattern =
  /^\/(?:_next|archive-scans|organizations)(?:\/|$)/;
const workerPathPattern = /^\/.*\.worker\.js$/;
const hopByHopHeaders = new Set([
  "connection",
  "content-length",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

function resolvePort(value: string | undefined): number {
  if (value === undefined || value.trim() === "") return defaultPort;

  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535)
    throw new Error(`Invalid PORT value: ${value}`);

  return port;
}

function shouldCacheRequest(path: string): boolean {
  return (
    assetPathPattern.test(path) ||
    path === "/favicon.ico" ||
    workerPathPattern.test(path)
  );
}

function frontendV4Enabled(): boolean {
  if (process.env.DISABLE_FRONTEND_V4_PREVIEW === "1") return false;
  return process.env.ENABLE_FRONTEND_V4_PREVIEW !== "0";
}

function getApiOrigin(): string {
  return process.env.STELLAR_ATLAS_API_ORIGIN ?? "http://127.0.0.1:3000";
}

function getFrontendV4Origin(): string {
  return process.env.FRONTEND_V4_ORIGIN ?? "http://127.0.0.1:3104";
}

function stripPathPrefix(path: string, prefix: string): string {
  const stripped = path.slice(prefix.length);
  return stripped.length === 0 ? "/" : stripped;
}

function getApiDocsPath(path: string): string {
  return `/docs${stripPathPrefix(path, "/api-docs")}`;
}

function getForwardHeaders(req: Request): Record<string, string> {
  const headers: Record<string, string> = {};

  for (const [headerName, value] of Object.entries(req.headers)) {
    const normalizedName = headerName.toLowerCase();
    if (hopByHopHeaders.has(normalizedName)) continue;
    if (typeof value === "string") headers[normalizedName] = value;
    else if (Array.isArray(value)) headers[normalizedName] = value.join(", ");
  }

  headers["user-agent"] =
    headers["user-agent"] ?? "stellaratlas-frontend-proxy";

  return headers;
}

function rewriteApiDocsBody(
  body: Buffer,
  response: globalThis.Response,
): Buffer {
  if (!response.headers.get("content-type")?.includes("text/html")) return body;

  return Buffer.from(
    rewriteApiDocsHtml(body.toString("utf8"), Date.now().toString(36)),
  );
}

function shouldProxyFrontendV4(path: string): boolean {
  if (!frontendV4Enabled()) return false;
  if (
    apiPathPattern.test(path) ||
    apiDocsPathPattern.test(path) ||
    graphqlPathPattern.test(path)
  )
    return false;
  if (legacyPathPattern.test(path)) return false;
  if (path === "/robots.txt" || path.startsWith("/schemas/")) return false;
  if (assetPathPattern.test(path) || workerPathPattern.test(path)) return false;
  if (path === "/favicon.ico" || path.endsWith(".png")) return false;

  return (
    path === "/" || modernFrontendPathPattern.test(path) || !path.includes(".")
  );
}

function shouldServeLegacyIndex(req: Request): boolean {
  return (
    (req.method === "GET" || req.method === "HEAD") &&
    legacyPathPattern.test(req.path) &&
    req.accepts("html") === "html" &&
    !req.path.includes(".")
  );
}

function shouldServeModernFallback(req: Request): boolean {
  return (
    (req.method === "GET" || req.method === "HEAD") &&
    req.accepts("html") === "html" &&
    !req.path.includes(".")
  );
}

dotenv.config({ quiet: true });

const app = express();
const port = resolvePort(process.env.PORT);

app.use((req: Request, res: Response, next: NextFunction) => {
  if (
    (req.method === "GET" || req.method === "HEAD") &&
    ["stellaratlas.io", "www.stellaratlas.io"].includes(req.hostname?.toLowerCase() ?? "") &&
    req.headers.authorization === undefined &&
    req.headers.upgrade === undefined &&
    /^\/notify(?:\/|$)/.test(req.path) &&
    req.accepts("html") === "html"
  ) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.redirect(307, "/legacy" + req.originalUrl);
    return;
  }
  next();
});

app.use((req: Request, res: Response, next: NextFunction) => {
  if (!modernCompatibilityPathPattern.test(req.path)) {
    next();
    return;
  }

  try {
    res.redirect(308, compatibilityRedirect(req.originalUrl));
  } catch {
    res.status(400).send("Invalid compatibility path");
  }
});

app.use((req: Request, res: Response, next: NextFunction) => {
  if (
    !apiPathPattern.test(req.path) &&
    !apiDocsPathPattern.test(req.path) &&
    !graphqlPathPattern.test(req.path)
  ) {
    next();
    return;
  }

  const targetPath = apiDocsPathPattern.test(req.path)
    ? getApiDocsPath(req.originalUrl)
    : req.originalUrl;
  proxyRequest(
    req,
    res,
    getApiOrigin(),
    targetPath,
    getForwardHeaders(req),
    apiDocsPathPattern.test(req.path) ? rewriteApiDocsBody : undefined,
  ).catch((error) => {
    if (error instanceof InvalidProxyPath) {
      res.status(400).send("Invalid proxy path");
      return;
    }
    const message = error instanceof Error ? error.message : "Proxy failed";
    res.status(502).send(`API unavailable: ${message}`);
  });
});

app.use((req: Request, res: Response, next: NextFunction) => {
  if (!shouldProxyFrontendV4(req.path)) {
    next();
    return;
  }

  proxyRequest(req, res, getFrontendV4Origin(), req.originalUrl, getForwardHeaders(req)).catch(
    (error) => {
      if (error instanceof InvalidProxyPath) {
        res.status(400).send("Invalid proxy path");
        return;
      }
      if (shouldServeModernFallback(req)) {
        req.url = "/legacy/index.html";
        next();
        return;
      }

      const message = error instanceof Error ? error.message : "Proxy failed";
      res.status(502).send(`Modern frontend unavailable: ${message}`);
    },
  );
});

app.disable("x-powered-by");

app.use((req: Request, res: Response, next: NextFunction) => {
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1");
  res.setHeader("X-Content-Type-Options", "nosniff");

  if (shouldCacheRequest(req.path))
    res.setHeader("Cache-Control", `public, max-age=${assetCacheTimeMs}`);

  next();
});

app.use((req: Request, _res: Response, next: NextFunction) => {
  if (shouldServeLegacyIndex(req)) req.url = "/legacy/index.html";
  next();
});

app.get(
  "/schemas/*.json",
  (_req: Request, res: Response, next: NextFunction) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    next();
  },
);

app.use("/legacy", express.static("dist"));
app.use(express.static("dist", { index: false }));

app.listen(port, () => {
  console.log(`app listening on port: ${port}`);
});
