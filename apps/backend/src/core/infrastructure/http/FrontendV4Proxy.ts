import type { NextFunction, Request, Response } from 'express';

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

function buildTargetUrl(originalUrl: string, origin: URL): URL {
	const queryIndex = originalUrl.indexOf('?');
	const pathname = queryIndex < 0 ? originalUrl : originalUrl.slice(0, queryIndex);
	const query = queryIndex < 0 ? '' : originalUrl.slice(queryIndex);
	const path = nextAssetPathPattern.test(pathname)
		? pathname
		: pathname.slice('/new-ui'.length) || '/';
	validatePathAndQuery(path, query);
	// Assign components: caller input must never be resolved as a URL authority.
	const target = new URL(origin.href);
	target.pathname = path;
	target.search = query;
	if (
		target.origin !== origin.origin ||
		decodeURIComponent(target.pathname) !== decodeURIComponent(path)
	) {
		throw new InvalidPreviewPath();
	}
	return target;
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

async function readBoundedBody(response: globalThis.Response): Promise<Buffer> {
	const length = response.headers.get('content-length');
	if (length && Number(length) > maximumResponseBytes) {
		throw new Error('Upstream response too large');
	}
	if (!response.body) return Buffer.alloc(0);
	const reader = response.body.getReader();
	let body = Buffer.alloc(64 * 1024);
	let size = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (value.byteLength > maximumResponseBytes - size) {
				throw new Error('Upstream response too large');
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
		}
		return body.subarray(0, size);
	} catch (error) {
		void reader.cancel().catch(() => undefined);
		throw error;
	} finally {
		reader.releaseLock();
	}
}

async function proxyFrontendV4(req: Request, res: Response): Promise<void> {
	if (req.method !== 'GET' && req.method !== 'HEAD') {
		res.setHeader('Allow', 'GET, HEAD');
		res.status(405).send('Method Not Allowed');
		return;
	}

	const targetUrl = buildTargetUrl(req.originalUrl, getFrontendV4Origin());
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), upstreamTimeoutMs);
	const onClose = (): void => controller.abort();
	res.once('close', onClose);
	try {
		const response = await fetch(targetUrl, {
			headers: {
				accept: req.get('accept') ?? '*/*',
				'user-agent': req.get('user-agent') ?? 'stellaratlas-preview-proxy'
			},
			method: req.method,
			redirect: 'manual',
			signal: controller.signal
		});
		const location = response.headers.get('location');
		let redirect: string | undefined;
		if (location) {
			try {
				redirect = previewLocation(location, targetUrl);
			} catch {
				throw new Error('Invalid upstream redirect');
			}
		}
		const noBody = req.method === 'HEAD' || [204, 205, 304].includes(response.status);
		const body = noBody ? undefined : await readBoundedBody(response);
		res.status(response.status);
		for (const headerName of ['cache-control', 'content-type', 'etag', 'last-modified']) {
			const value = response.headers.get(headerName);
			if (value) res.setHeader(headerName, value);
		}
		if (redirect) res.setHeader('location', redirect);
		if (body) res.send(body);
		else res.end();
	} finally {
		clearTimeout(timeout);
		controller.abort();
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
