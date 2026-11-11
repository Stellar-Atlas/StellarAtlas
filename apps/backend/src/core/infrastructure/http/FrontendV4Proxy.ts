import type { NextFunction, Request, Response } from 'express';
import http, { type ClientRequest, type IncomingMessage } from 'node:http';
import https from 'node:https';
import { Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';

const previewPathPattern = /^\/new-ui(?:[/?\\#]|$)/;
const nextAssetPathPattern = /^\/_next(?:[/?\\#]|$)/;
const defaultFrontendV4Origin = 'http://127.0.0.1:3104';
const maximumResponseBytes = 32 * 1024 * 1024;
const upstreamTimeoutMs = 30_000;
let trustedOrigin: URL | undefined;

class InvalidPreviewPath extends Error {}

function frontendV4PreviewEnabled(): boolean {
	if (process.env.DISABLE_FRONTEND_V4_PREVIEW === '1') return false;
	return process.env.ENABLE_FRONTEND_V4_PREVIEW !== '0';
}

function getFrontendV4Origin(): URL {
	if (trustedOrigin) return trustedOrigin;
	const configured = process.env.FRONTEND_V4_ORIGIN ?? defaultFrontendV4Origin;
	if (/[\s\\]/.test(configured)) throw new Error('Invalid frontend origin');
	const origin = new URL(configured);
	if (
		!['http:', 'https:'].includes(origin.protocol) ||
		origin.username ||
		origin.password ||
		origin.pathname !== '/' ||
		origin.search ||
		origin.hash
	) {
		throw new Error('Invalid frontend origin');
	}
	trustedOrigin = origin;
	return origin;
}

function validatePathAndQuery(path: string, query: string): void {
	if (
		/[\u0000-\u0020\u007f\\#]/.test(path + query) ||
		/%(?![a-f\d]{2})|%(?:0[a-f\d]|1[a-f\d]|7f|5c)/i.test(path + query) ||
		/%(?:2f|25)/i.test(path)
	) {
		throw new InvalidPreviewPath();
	}
	let decoded: string;
	try {
		decoded = decodeURIComponent(path);
	} catch {
		throw new InvalidPreviewPath();
	}
	if (
		!path.startsWith('/') ||
		path.includes('//') ||
		decoded.split('/').some((segment) => segment === '.' || segment === '..')
	) {
		throw new InvalidPreviewPath();
	}
}

function buildTargetPath(originalUrl: string): string {
	const queryIndex = originalUrl.indexOf('?');
	const pathname = queryIndex < 0 ? originalUrl : originalUrl.slice(0, queryIndex);
	const query = queryIndex < 0 ? '' : originalUrl.slice(queryIndex);
	const path = nextAssetPathPattern.test(pathname)
		? pathname
		: pathname.slice('/new-ui'.length) || '/';
	validatePathAndQuery(path, query);
	// Normalize only the origin-form path; no caller-controlled URL reaches transport.
	const target = new URL('http://stellaratlas.invalid');
	target.pathname = path;
	target.search = query;
	if (decodeURIComponent(target.pathname) !== decodeURIComponent(path)) {
		throw new InvalidPreviewPath();
	}
	return target.pathname + target.search;
}

function previewLocation(location: string, target: URL): string {
	if (/[\u0000-\u0020\u007f\\]/.test(location)) {
		throw new Error('Invalid upstream redirect');
	}
	const redirect = new URL(location, target);
	if (redirect.origin !== target.origin || redirect.username || redirect.password) {
		throw new Error('Untrusted upstream redirect');
	}
	validatePathAndQuery(redirect.pathname, redirect.search);
	const prefix = nextAssetPathPattern.test(redirect.pathname) ? '' : '/new-ui';
	return prefix + redirect.pathname + redirect.search + redirect.hash;
}

async function readBoundedBody(
	response: IncomingMessage,
	signal: AbortSignal
): Promise<Buffer> {
	const encoding = response.headers['content-encoding']?.trim().toLowerCase();
	const decoder = !encoding || encoding === 'identity' ? undefined
		: encoding === 'gzip' ? createGunzip()
			: encoding === 'deflate' ? createInflate()
				: encoding === 'br' ? createBrotliDecompress() : null;
	if (decoder === null) throw new Error('Unsupported upstream encoding');
	const length = response.headers['content-length'];
	if (!decoder && length && Number(length) > maximumResponseBytes) {
		throw new Error('Upstream response too large');
	}
	let body = Buffer.alloc(64 * 1024);
	let size = 0;
	const sink = new Writable({
		write(value: Buffer, _encoding, done) {
			if (value.byteLength > maximumResponseBytes - size) {
				done(new Error('Upstream response too large'));
				return;
			}
			if (size + value.byteLength > body.length) {
				const grown = Buffer.alloc(
					Math.min(maximumResponseBytes,
						Math.max(body.length * 2, size + value.byteLength))
				);
				body.copy(grown, 0, 0, size);
				body = grown;
			}
			body.set(value, size);
			size += value.byteLength;
			done();
		}
	});
	// pipeline destroys the socket-facing response, decoder and sink on any failure.
	if (decoder) await pipeline(response, decoder, sink, { signal });
	else await pipeline(response, sink, { signal });
	return body.subarray(0, size);
}

async function proxyFrontendV4(req: Request, res: Response): Promise<void> {
	if (req.method !== 'GET' && req.method !== 'HEAD') {
		res.setHeader('Allow', 'GET, HEAD');
		res.status(405).send('Method Not Allowed');
		return;
	}

	const configuredOrigin = getFrontendV4Origin();
	const requestPath = buildTargetPath(req.originalUrl);
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), upstreamTimeoutMs);
	const onClose = (): void => controller.abort();
	res.once('close', onClose);
	let outbound: ClientRequest | undefined;
	let upstream: IncomingMessage | undefined;
	try {
		const transport = configuredOrigin.protocol === 'https:' ? https : http;
		const response = await new Promise<IncomingMessage>((resolve, reject) => {
			// Authority fields come only from trusted configuration. Native requests
			// take the validated caller input solely as path and never follow redirects.
			outbound = transport.request({
				protocol: configuredOrigin.protocol,
				hostname: configuredOrigin.hostname.replace(/^\[|\]$/g, ''),
				port: configuredOrigin.port || undefined,
				path: requestPath,
				method: req.method,
				headers: {
					accept: req.get('accept') ?? '*/*',
					'accept-encoding': 'gzip, deflate, br',
					'user-agent': req.get('user-agent') ?? 'stellaratlas-preview-proxy'
				},
				signal: controller.signal
			}, (message) => {
				upstream = message;
				resolve(message);
			});
			outbound.once('error', reject);
			outbound.end();
		});
		const status = response.statusCode ?? 502;
		const location = response.headers.location;
		let redirect: string | undefined;
		if (location) {
			try {
				redirect = previewLocation(location, new URL(requestPath, configuredOrigin));
			} catch {
				throw new Error('Invalid upstream redirect');
			}
		}
		const noBody = req.method === 'HEAD' || [204, 205, 304].includes(status);
		const body = noBody ? undefined : await readBoundedBody(response, controller.signal);
		res.status(status);
		for (const headerName of ['cache-control', 'content-type', 'etag', 'last-modified']) {
			const value = response.headers[headerName];
			if (value) res.setHeader(headerName, value);
		}
		if (redirect) res.setHeader('location', redirect);
		if (body) res.send(body);
		else res.end();
	} finally {
		clearTimeout(timeout);
		controller.abort();
		outbound?.destroy();
		upstream?.destroy();
		res.removeListener('close', onClose);
	}
}

export function frontendV4ProxyMiddleware(
	req: Request,
	res: Response,
	next: NextFunction
): void {
	if (
		(!previewPathPattern.test(req.originalUrl) &&
			!nextAssetPathPattern.test(req.originalUrl)) ||
		!frontendV4PreviewEnabled()
	) {
		next();
		return;
	}

	proxyFrontendV4(req, res).catch((error) => {
		if (res.headersSent) {
			res.destroy();
			return;
		}
		if (error instanceof InvalidPreviewPath) {
			res.status(400).send('Invalid preview path');
			return;
		}
		res.status(502).send('Frontend v4 preview unavailable');
	});
}
