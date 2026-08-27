import express, { Router } from 'express';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { IncomingMessage } from 'node:http';

export interface ReadOnlyUpstreamRouterConfig {
	readonly forwardPublicHost?: boolean;
	readonly publicPrefix: string;
	readonly rewriteJsonLinks?: boolean;
	readonly serviceName: string;
	readonly targetBaseUrl: string;
}

const forwardedRequestHeaders = [
	'accept',
	'if-modified-since',
	'if-none-match',
	'range'
] as const;
const forwardedResponseHeaders = [
	'accept-ranges',
	'cache-control',
	'content-disposition',
	'content-length',
	'content-range',
	'content-type',
	'etag',
	'last-modified',
	'link',
	'retry-after'
] as const;
const maximumJsonBytes = 32 * 1024 * 1024;
const upstreamTimeoutMs = 30_000;

export const ReadOnlyUpstreamRouterWrapper = (
	config: ReadOnlyUpstreamRouterConfig
): Router => {
	const router = express.Router();
	const targetBaseUrl = parseTargetBaseUrl(config.targetBaseUrl);

	router.use((req, res) => {
		if (req.method !== 'GET' && req.method !== 'HEAD') {
			res.setHeader('Allow', 'GET, HEAD');
			return res.status(405).json({ error: 'Method not allowed' });
		}

		const targetUrl = buildTargetUrl(targetBaseUrl, req.url);
		const headers: Record<string, string> = {};
		for (const name of forwardedRequestHeaders) {
			const value = req.get(name);
			if (value !== undefined) headers[name] = value;
		}
		if (config.forwardPublicHost) {
			const host = req.get('host');
			if (host !== undefined) {
				headers.host = host;
				headers['x-forwarded-host'] = host;
			}
			headers['x-forwarded-proto'] = req.protocol;
		}
		headers['user-agent'] =
			req.get('user-agent') ?? 'StellarAtlas fixed upstream proxy';

		const transport =
			targetUrl.protocol === 'https:' ? httpsRequest : httpRequest;
		const upstreamRequest = transport(
			targetUrl,
			{ headers, method: req.method },
			(upstreamResponse) => {
				handleUpstreamResponse(
					req,
					res,
					upstreamResponse,
					targetBaseUrl,
					config
				);
			}
		);
		upstreamRequest.setTimeout(upstreamTimeoutMs, () => {
			upstreamRequest.destroy(new Error('Upstream request timed out'));
		});
		upstreamRequest.once('error', () => {
			if (res.headersSent) {
				res.destroy();
				return;
			}
			res.status(502).json({
				error: config.serviceName + ' upstream is unavailable'
			});
		});
		res.once('close', () => upstreamRequest.destroy());
		upstreamRequest.end();
	});

	return router;
};

function handleUpstreamResponse(
	req: express.Request,
	res: express.Response,
	upstream: IncomingMessage,
	targetBaseUrl: URL,
	config: ReadOnlyUpstreamRouterConfig
): void {
	const status = upstream.statusCode ?? 502;
	res.status(status);
	const contentType = firstHeader(upstream.headers['content-type']);
	const shouldRewrite =
		config.rewriteJsonLinks === true &&
		req.method !== 'HEAD' &&
		contentType?.toLowerCase().includes('json') === true;

	if (shouldRewrite) {
		void bufferAndRewriteJson(req, res, upstream, targetBaseUrl, config);
		return;
	}

	copyResponseHeaders(res, upstream, false);
	if (req.method === 'HEAD') {
		upstream.resume();
		res.end();
		return;
	}
	upstream.once('error', () => res.destroy());
	upstream.pipe(res);
}

async function bufferAndRewriteJson(
	req: express.Request,
	res: express.Response,
	upstream: IncomingMessage,
	targetBaseUrl: URL,
	config: ReadOnlyUpstreamRouterConfig
): Promise<void> {
	try {
		const chunks: Buffer[] = [];
		let byteCount = 0;
		for await (const chunk of upstream) {
			const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
			byteCount += buffer.byteLength;
			if (byteCount > maximumJsonBytes) {
				throw new Error('Upstream JSON response exceeded the proxy limit');
			}
			chunks.push(buffer);
		}
		const publicOrigin = req.protocol + '://' + (req.get('host') ?? '');
		const publicBase =
			publicOrigin + normalizePublicPrefix(config.publicPrefix) + '/';
		const body = Buffer.concat(chunks)
			.toString('utf8')
			.replaceAll(publicOrigin + '/', publicBase)
			.replaceAll(targetBaseUrl.origin + '/', publicBase);
		copyResponseHeaders(res, upstream, true);
		res.setHeader('Content-Length', Buffer.byteLength(body).toString());
		res.send(body);
	} catch {
		if (res.headersSent) {
			res.destroy();
			return;
		}
		res.status(502).json({
			error: config.serviceName + ' upstream returned an invalid response'
		});
	}
}

function copyResponseHeaders(
	res: express.Response,
	upstream: IncomingMessage,
	rewritten: boolean
): void {
	for (const name of forwardedResponseHeaders) {
		if (rewritten && (name === 'content-length' || name === 'etag')) continue;
		const value = upstream.headers[name];
		if (value !== undefined) res.setHeader(name, value);
	}
}

function buildTargetUrl(base: URL, requestUrl: string): URL {
	const incoming = new URL(requestUrl, 'http://stellaratlas.invalid');
	const target = new URL(base);
	const basePath = target.pathname.endsWith('/')
		? target.pathname
		: target.pathname + '/';
	target.pathname = basePath + incoming.pathname.replace(/^\/+/, '');
	target.search = incoming.search;
	return target;
}

function parseTargetBaseUrl(value: string): URL {
	const parsed = new URL(value);
	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
		throw new Error('Fixed upstream URL must use HTTP or HTTPS');
	}
	parsed.username = '';
	parsed.password = '';
	parsed.search = '';
	parsed.hash = '';
	return parsed;
}

function normalizePublicPrefix(value: string): string {
	const prefixed = value.startsWith('/') ? value : '/' + value;
	return prefixed.endsWith('/') ? prefixed.slice(0, -1) : prefixed;
}

function firstHeader(value: string | string[] | undefined): string | undefined {
	return Array.isArray(value) ? value[0] : value;
}

export { ReadOnlyUpstreamRouterWrapper as readOnlyUpstreamRouter };
