import historyApiFallback from "connect-history-api-fallback";
import dotenv from "dotenv";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";

const defaultPort = 3000;
const assetCacheTimeMs = 86_400_000 * 7;
const assetPathPattern = /^\/(css|js|img|fonts)\/.+/;
const workerPathPattern = /^\/.*\.worker\.js$/;
const previewPathPattern = /^\/new-ui(?:\/|$)/;

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

function frontendV4PreviewEnabled(): boolean {
  if (process.env.DISABLE_FRONTEND_V4_PREVIEW === "1") return false;
  return process.env.ENABLE_FRONTEND_V4_PREVIEW !== "0";
}

function getFrontendV4Origin(): string {
  return process.env.FRONTEND_V4_ORIGIN ?? "http://127.0.0.1:3104";
}

async function proxyFrontendV4(req: Request, res: Response): Promise<void> {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.status(405).send("Method Not Allowed");
    return;
  }

  const targetUrl = new URL(req.originalUrl, getFrontendV4Origin());
  const response = await fetch(targetUrl, {
    headers: {
      accept: req.get("accept") ?? "*/*",
      "user-agent": req.get("user-agent") ?? "stellaratlas-preview-proxy",
    },
    method: req.method,
  });

  res.status(response.status);

  for (const headerName of ["content-type", "cache-control"]) {
    const headerValue = response.headers.get(headerName);
    if (headerValue) res.setHeader(headerName, headerValue);
  }

  if (req.method === "HEAD") {
    res.end();
    return;
  }

  const body = Buffer.from(await response.arrayBuffer());
  res.send(body);
}

dotenv.config({ quiet: true });

const app = express();
const port = resolvePort(process.env.PORT);

app.use((req: Request, res: Response, next: NextFunction) => {
  if (!previewPathPattern.test(req.originalUrl) || !frontendV4PreviewEnabled()) {
    next();
    return;
  }

  proxyFrontendV4(req, res).catch((error) => {
    const message = error instanceof Error ? error.message : "Proxy failed";
    res.status(502).send(`Frontend v4 preview unavailable: ${message}`);
  });
});

app.use(historyApiFallback());
app.disable("x-powered-by");

app.use((req: Request, res: Response, next: NextFunction) => {
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1");
  res.setHeader("X-Content-Type-Options", "nosniff");

  if (shouldCacheRequest(req.path))
    res.setHeader("Cache-Control", `public, max-age=${assetCacheTimeMs}`);

  next();
});

app.get(
  "/schemas/*.json",
  (_req: Request, res: Response, next: NextFunction) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    next();
  },
);

app.use(express.static("dist"));

app.listen(port, () => {
  console.log(`app listening on port: ${port}`);
});
