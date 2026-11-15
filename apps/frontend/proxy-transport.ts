import type { Request, Response } from "express";
import http, { type ClientRequest, type IncomingMessage, type RequestOptions } from "node:http";
import https from "node:https";
import { Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";

const maximumBodyBytes = 32 * 1024 * 1024;
// Permit long-running API work: bound headers and idle sockets, not active work.
export const proxyInactivityMs = 300_000;

export class InvalidProxyPath extends Error {}

export function validateProxyPath(path: string): string {
  const pathname = path.split("?", 1)[0];
  if (!path.startsWith("/") || path.startsWith("//") ||
    /[\u0000-\u0020\u007f\\#]/.test(path) ||
    /%(?![a-f\d]{2})|%(?:25)*(?:0[a-f\d]|1[a-f\d]|7f|5c)/i.test(path)) {
    throw new InvalidProxyPath("Invalid proxy path");
  }
  let decoded: string;
  try { decoded = decodeURIComponent(pathname); }
  catch { throw new InvalidProxyPath("Invalid proxy path"); }
  if (decoded.startsWith("//") || /^\/%(?:25)*2f/i.test(pathname)) {
    throw new InvalidProxyPath("Ambiguous proxy path");
  }
  return path;
}

export function compatibilityRedirect(path: string): string {
  const stripped = path.slice("/new-ui".length);
  // A fixed local dot segment pins URL interpretation to this origin. Browsers
  // normalize /./nodes to /nodes; caller text can never supply an authority.
  return "/." + validateProxyPath(!stripped || stripped.startsWith("?") ? `/${stripped}` : stripped);
}

export function configuredProxyOrigin(value: string): URL {
  if (/[\s\\]/.test(value)) throw new Error("Invalid proxy origin");
  const origin = new URL(value);
  if (!["http:", "https:"].includes(origin.protocol) || origin.username ||
    origin.password || origin.pathname !== "/" || origin.search || origin.hash) {
    throw new Error("Invalid proxy origin");
  }
  return origin;
}

export function proxyRequestOptions(origin: URL, path: string): RequestOptions {
  return {
    protocol: origin.protocol,
    hostname: origin.hostname.replace(/^\[|\]$/g, ""),
    port: origin.port || undefined,
    path: validateProxyPath(path),
  };
}

export function proxyLocation(location: string, origin: URL, path: string): string {
  if (/[\u0000-\u0020\u007f\\]/.test(location)) throw new Error("Invalid upstream redirect");
  const target = new URL(location, new URL(path, origin));
  if (target.origin !== origin.origin || target.username || target.password) {
    throw new Error("Untrusted upstream redirect");
  }
  return validateProxyPath(target.pathname + target.search) + target.hash;
}

async function readBody(message: IncomingMessage, signal: AbortSignal, decode = false): Promise<Buffer> {
  const encoding = decode ? message.headers["content-encoding"]?.trim().toLowerCase() : undefined;
  const decoder = !encoding || encoding === "identity" ? undefined : encoding === "gzip"
    ? createGunzip() : encoding === "deflate" ? createInflate()
      : encoding === "br" ? createBrotliDecompress() : null;
  if (decoder === null) throw new Error("Unsupported upstream encoding");
  const chunks: Buffer[] = [];
  let size = 0;
  const sink = new Writable({ write(chunk: Buffer, _encoding, done) {
    if (chunk.length > maximumBodyBytes - size) return done(new Error("Proxy body too large"));
    chunks.push(chunk); size += chunk.length; done();
  } });
  if (decoder) await pipeline(message, decoder, sink, { signal });
  else await pipeline(message, sink, { signal });
  return Buffer.concat(chunks, size);
}

export async function proxyRequest(
  req: Request, res: Response, configured: string, path: string,
  headers: Record<string, string>,
  transformBody?: (body: Buffer, response: globalThis.Response) => Buffer,
): Promise<void> {
  const origin = configuredProxyOrigin(configured);
  const options = proxyRequestOptions(origin, path);
  const controller = new AbortController();
  let headerTimeout: ReturnType<typeof setTimeout> | undefined;
  const onClose = (): void => controller.abort();
  res.once("close", onClose);
  if (req.aborted || res.destroyed) controller.abort();
  let outbound: ClientRequest | undefined;
  let upstream: IncomingMessage | undefined;
  try {
    const body = req.method === "GET" || req.method === "HEAD" ? undefined
      : await readBody(req, controller.signal);
    const transport = origin.protocol === "https:" ? https : http;
    const response = await new Promise<IncomingMessage>((resolve, reject) => {
      headerTimeout = setTimeout(() => controller.abort(), proxyInactivityMs);
      // Authority is configuration-only; caller input is a validated origin-form path.
      // Native requests do not follow redirects.
      outbound = transport.request({ ...options,
        headers: { ...headers, "accept-encoding": "gzip, deflate, br" }, method: req.method,
        signal: controller.signal }, (message) => {
          clearTimeout(headerTimeout);
          upstream = message;
          resolve(message);
        });
      outbound.setTimeout(proxyInactivityMs, () => controller.abort());
      outbound.once("error", reject);
      outbound.end(body);
    });
    const location = response.headers.location;
    const redirect = location ? proxyLocation(location, origin, path) : undefined;
    const status = response.statusCode ?? 502;
    const noBody = req.method === "HEAD" || [204, 205, 304].includes(status);
    const upstreamBody = noBody ? undefined : await readBody(response, controller.signal, true);
    const metadata = new globalThis.Response(null, { headers: response.headers["content-type"]
      ? { "content-type": response.headers["content-type"] } : {} });
    const result = upstreamBody && transformBody ? transformBody(upstreamBody, metadata) : upstreamBody;
    res.status(status);
    for (const name of ["access-control-allow-origin", "cache-control", "content-type", "etag"]) {
      const value = response.headers[name];
      if (value) res.setHeader(name, value);
    }
    if (redirect) res.setHeader("location", redirect);
    if (transformBody) res.setHeader("cache-control", "no-store");
    if (result) res.send(result);
    else res.end();
  } finally {
    clearTimeout(headerTimeout); controller.abort();
    outbound?.destroy(); upstream?.destroy();
    res.removeListener("close", onClose);
  }
}
