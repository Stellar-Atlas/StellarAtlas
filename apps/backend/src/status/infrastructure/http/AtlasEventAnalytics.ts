import type { IncomingHttpHeaders } from 'node:http';
import type { RequestHandler, Response } from 'express';

const events = {
	contractEvents: ['Successful event query', '/explorer/contract-events'],
	rest: ['Public REST use', '/docs/api'],
	graphql: ['Public GraphQL use', '/docs/graphql'],
	websocket: ['Public WebSocket connection', '/docs/live-updates']
} as const;
type AtlasEvent = keyof typeof events;

const budget: Record<AtlasEvent, { count: number; resetAt: number }> = {
	contractEvents: { count: 0, resetAt: 0 },
	rest: { count: 0, resetAt: 0 },
	graphql: { count: 0, resetAt: 0 },
	websocket: { count: 0, resetAt: 0 }
};
let inFlight = 0;

export function allowsProgrammaticAnalytics(headers: IncomingHttpHeaders): boolean {
	return headers.origin === undefined && headers.referer === undefined &&
		headers['sec-fetch-mode'] === undefined && headers['sec-fetch-site'] === undefined;
}

function analyticsOptedOut(headers: IncomingHttpHeaders): boolean {
	const value = headers['sec-gpc'];
	return value !== undefined && /(?:^|,)\s*1\s*(?:,|$)/.test(String(value));
}

export function recordAtlasResponse(
	event: AtlasEvent, headers: IncomingHttpHeaders, response: Response
): void {
	if (!process.env.ATLAS_ANALYTICS_ORIGIN || analyticsOptedOut(headers)) return;
	response.once('finish', () => {
		if (response.statusCode === 200) recordAtlasApiEvent(event, headers);
	});
}

export const observeAtlasRest: RequestHandler = (request, response, next) => {
	if (request.method === 'GET' && allowsProgrammaticAnalytics(request.headers))
		recordAtlasResponse('rest', request.headers, response);
	next();
};

export const observeAtlasTypedRest: RequestHandler = (request, response, next) => {
	if (request.query.view === 'typed') observeAtlasRest(request, response, next);
	else next();
};

export function recordAtlasApiEvent(event: AtlasEvent, headers: IncomingHttpHeaders): void {
	const configured = process.env.ATLAS_ANALYTICS_ORIGIN;
	if (!configured || inFlight >= 2 || analyticsOptedOut(headers)) return;
	const state = budget[event];
	const now = performance.now();
	const socket = event === 'websocket';
	if (now >= state.resetAt) {
		state.count = 0;
		state.resetAt = now + (socket ? 30_000 : 60_000);
	}
	if (state.count >= (socket ? 1 : 12)) return;
	let endpoint: URL;
	try {
		const origin = new URL(configured);
		if (origin.origin !== configured) return;
		if (origin.protocol !== 'https:' &&
			!(origin.protocol === 'http:' && origin.hostname === '127.0.0.1')) return;
		endpoint = new URL('/api/event', origin);
	} catch {
		return;
	}
	state.count++;
	inFlight++;
	setImmediate(() => {
		void send(endpoint, event).finally(() => { inFlight--; });
	}).unref();
}

async function send(endpoint: URL, event: AtlasEvent): Promise<void> {
	try {
		const [name, path] = events[event];
		const response = await fetch(endpoint, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'User-Agent': 'StellarAtlasTelemetry/1.0'
			},
			body: JSON.stringify({ name, domain: 'stellaratlas.io', url: 'https://stellaratlas.io' + path }),
			credentials: 'omit',
			redirect: 'error',
			signal: AbortSignal.timeout(2000)
		});
		await response.body?.cancel();
	} catch {
		// No retry or dependency on the API response lifecycle.
	}
}
