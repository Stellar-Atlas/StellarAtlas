import dotenv from "dotenv";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { rewriteApiDocsHtml } from "./api-docs-proxy.js";

const defaultPort = 3000;
const assetCacheTimeMs = 86_400_000 * 7;
const apiDocsPathPattern = /^\/api-docs(?:\/|$)/;
const apiPathPattern = /^\/v1(?:\/|$)/;
const assetPathPattern = /^\/(assets|css|js|img|fonts)\/.+/;
const legacyPathPattern = /^\/legacy(?:\/|$)/;
const modernCompatibilityPathPattern = /^\/new-ui(?:\/|$)/;
const modernStaticPathPattern = /^\/_next(?:\/|$)/;
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

function getModernCompatibilityRedirect(path: string): string {
  return stripPathPrefix(path, "/new-ui");
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

function readRequestBody(req: Request): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function proxyRequest(
  req: Request,
  res: Response,
  origin: string,
  path: string,
  transformBody?: (body: Buffer, response: globalThis.Response) => Buffer,
): Promise<void> {
  const targetUrl = new URL(path, origin);
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  const requestBody = hasBody ? await readRequestBody(req) : undefined;

  const response = await fetch(targetUrl, {
    body: requestBody,
    headers: getForwardHeaders(req),
    method: req.method,
  });

  res.status(response.status);

  for (const headerName of [
    "access-control-allow-origin",
    "cache-control",
    "content-type",
    "etag",
    "location",
  ]) {
    const headerValue = response.headers.get(headerName);
    if (headerValue) res.setHeader(headerName, headerValue);
  }
  if (transformBody) res.setHeader("cache-control", "no-store");

  if (req.method === "HEAD") {
    res.end();
    return;
  }

  const upstreamBody = Buffer.from(await response.arrayBuffer());
  const responseBody = transformBody
    ? transformBody(upstreamBody, response)
    : upstreamBody;
  res.send(responseBody);
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
  if (apiPathPattern.test(path) || apiDocsPathPattern.test(path)) return false;
  if (legacyPathPattern.test(path)) return false;
  if (path === "/robots.txt" || path.startsWith("/schemas/")) return false;
  if (assetPathPattern.test(path) || workerPathPattern.test(path)) return false;
  if (path === "/favicon.ico" || path.endsWith(".png")) return false;

  return (
    path === "/" || modernStaticPathPattern.test(path) || !path.includes(".")
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
  if (!modernCompatibilityPathPattern.test(req.path)) {
    next();
    return;
  }

  res.redirect(308, getModernCompatibilityRedirect(req.originalUrl));
});

app.use((req: Request, res: Response, next: NextFunction) => {
  if (!apiPathPattern.test(req.path) && !apiDocsPathPattern.test(req.path)) {
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
    apiDocsPathPattern.test(req.path) ? rewriteApiDocsBody : undefined,
  ).catch((error) => {
    const message = error instanceof Error ? error.message : "Proxy failed";
    res.status(502).send(`API unavailable: ${message}`);
  });
});

app.use((req: Request, res: Response, next: NextFunction) => {
  if (!shouldProxyFrontendV4(req.path)) {
    next();
    return;
  }

  proxyRequest(req, res, getFrontendV4Origin(), req.originalUrl).catch(
    (error) => {
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
