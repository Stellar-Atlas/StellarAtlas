import express, { Router } from 'express';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { IncomingMessage } from 'node:http';

export interface StellarRpcRouterConfig {
	readonly targetUrl: string;
}

const maximumRequestBytes = 2 * 1024 * 1024;
const upstreamTimeoutMs = 60_000;
const forwardedResponseHeaders = [
	'cache-control',
	'content-length',
	'content-type',
	'retry-after'
] as const;

export function stellarRpcRouter(config: StellarRpcRouterConfig): Router {
	const router = express.Router();
	const targetUrl = parseTargetUrl(config.targetUrl);

	router.use((req, res) => {
		if (req.method !== 'POST') {
			res.setHeader('Allow', 'POST');
			return res.status(405).json({ error: 'Method not allowed' });
		}
		if (!isJsonRpcPayload(req.body)) {
			return res.status(400).json({ error: 'Invalid JSON-RPC request' });
		}

		const body = JSON.stringify(req.body);
		const byteLength = Buffer.byteLength(body);
		if (byteLength > maximumRequestBytes) {
			return res.status(413).json({ error: 'JSON-RPC request is too large' });
		}

		const transport =
			targetUrl.protocol === 'https:' ? httpsRequest : httpRequest;
		const upstreamRequest = transport(
			targetUrl,
			{
				headers: {
					accept: 'application/json',
					'content-length': byteLength.toString(),
					'content-type': 'application/json',
					'user-agent':
						req.get('user-agent') ?? 'StellarAtlas Stellar RPC proxy'
				},
				method: 'POST'
			},
			(upstreamResponse) => {
				forwardResponse(res, upstreamResponse);
			}
		);
		upstreamRequest.setTimeout(upstreamTimeoutMs, () => {
			upstreamRequest.destroy(new Error('Stellar RPC request timed out'));
		});
		upstreamRequest.once('error', () => {
			if (res.headersSent) {
				res.destroy();
				return;
			}
			res.status(502).json({ error: 'Stellar RPC upstream is unavailable' });
		});
		req.once('aborted', () => upstreamRequest.destroy());
		upstreamRequest.end(body);
	});

	return router;
}

export function unavailableStellarRpcRouter(): Router {
	const router = express.Router();
	router.use((_req, res) => {
		res.setHeader('Retry-After', '60');
		return res.status(503).json({ error: 'Stellar RPC is not configured' });
	});
	return router;
}

function forwardResponse(
	res: express.Response,
	upstream: IncomingMessage
): void {
	res.status(upstream.statusCode ?? 502);
	for (const name of forwardedResponseHeaders) {
		const value = upstream.headers[name];
		if (value !== undefined) res.setHeader(name, value);
	}
	upstream.once('error', () => res.destroy());
	upstream.pipe(res);
}

function parseTargetUrl(value: string): URL {
	const target = new URL(value);
	if (target.protocol !== 'http:' && target.protocol !== 'https:') {
		throw new Error('Stellar RPC URL must use HTTP or HTTPS');
	}
	target.username = '';
	target.password = '';
	target.search = '';
	target.hash = '';
	return target;
}

function isJsonRpcPayload(value: unknown): boolean {
	return (
		(Array.isArray(value) && value.length > 0) ||
		(value !== null && typeof value === 'object' && !Array.isArray(value))
	);
}
