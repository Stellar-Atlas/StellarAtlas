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

dotenv.config({ quiet: true });

const app = express();
const port = resolvePort(process.env.PORT);

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
