import type { RequestHandler } from 'express';

interface Route {
	readonly literal: Map<string, Route>;
	parameter?: Route;
	readonly methods: Map<string, string>;
}
const node = (): Route => ({ literal: new Map(), methods: new Map() });
const segments = (path: string): string[] => path.replace(/\/$/, '').slice(1).split('/');
const methods = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];

function object(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? value as Record<string, unknown> : {};
}

function routeTree(document: unknown): Route {
	const root = node();
	for (const [path, value] of Object.entries(object(object(document).paths))) {
		if (!path.startsWith('/')) continue;
		let current = root;
		for (const part of segments(path)) {
			if (/^\{[^{}]+\}$/.test(part)) {
				current = current.parameter ??= node();
			} else {
				const literal = part.toLowerCase();
				const child = current.literal.get(literal) ?? node();
				current.literal.set(literal, child);
				current = child;
			}
		}
		const item = object(value);
		for (const method of methods) {
			if (Object.hasOwn(item, method)) current.methods.set(method.toUpperCase(), method.toUpperCase() + ' ' + path);
		}
	}
	return root;
}

function match(route: Route, parts: string[], method: string, index = 0): string | undefined {
	const part = parts[index];
	if (part === undefined) return route.methods.get(method);
	const child = route.literal.get(part.toLowerCase());
	return (child && match(child, parts, method, index + 1)) ??
		(part && route.parameter ? match(route.parameter, parts, method, index + 1) : undefined);
}

const statuses = ['2xx', '3xx', '4xx', '5xx', 'other', 'aborted', '429'] as const;
type Outcome = typeof statuses[number];
type Handshake = 'attempted' | 'accepted' | 'rejected';
const socketPaths = ['/v1/stream/data', '/v1/live/ws', '/v1/status/ws'] as const;
type SocketPath = typeof socketPaths[number];
type Output = Pick<NodeJS.WriteStream, 'write' | 'writableNeedDrain' | 'destroyed'>;

function outcome(status: number): Outcome {
	if (status === 429) return '429';
	if (status >= 200 && status < 600) return statuses[Math.floor(status / 100) - 2] ?? 'other';
	return 'other';
}

interface AtlasApiTraffic {
	observe: RequestHandler;
	handshake(path: SocketPath): (state: Handshake) => void;
	flush(): void;
}

/** No customer identity, URL parameters, database, event queue, or network sender. */
export function createAtlasApiTraffic(document: unknown, output: Output = process.stdout): AtlasApiTraffic {
	const root = routeTree(document);
	const counts = new Map<string, Partial<Record<Outcome, number>>>();
	const websocket = new Map<SocketPath, Record<Handshake, number>>();
	let deferredFlushes = 0;
	let from = new Date().toISOString();

	const observe: RequestHandler = (request, response, next) => {
		// Fixed fallback labels bound cardinality even for arbitrary methods/URLs.
		// Attach before reading the path or invoking any downstream middleware.
		let route = 'INVALID_PATH';
		response.once('close', () => {
			const bucket = counts.get(route) ?? {};
			const key = response.writableFinished ? outcome(response.statusCode) : 'aborted';
			bucket[key] = (bucket[key] ?? 0) + 1;
			counts.set(route, bucket);
		});
		try {
			const path = request.path;
			if (path.length <= 2048 && path.startsWith('/')) {
				const parts = segments(path);
				if (parts.length <= 16) route = methods.includes(request.method.toLowerCase())
					? match(root, parts, request.method) ?? 'UNMATCHED_ROUTE' : 'UNSUPPORTED_METHOD';
			}
		} catch { /* Observation must not turn an invalid URL into an application error. */ }
		next();
	};
	const handshake = (path: SocketPath) => (state: Handshake): void => {
		const bucket = websocket.get(path) ?? { attempted: 0, accepted: 0, rejected: 0 };
		bucket[state]++;
		websocket.set(path, bucket);
	};
	const flush = (): void => {
		const to = new Date().toISOString();
		if (counts.size === 0 && websocket.size === 0 && deferredFlushes === 0) { from = to; return; }
		if (output.destroyed || output.writableNeedDrain) {
			deferredFlushes++;
			return; // Keep a single bounded aggregate; don't enqueue another log.
		}
		const line = JSON.stringify({
			type: 'atlas_public_api_traffic_v1', from, to, deferredFlushes,
			httpScope: 'all_express_requests',
			http: Object.fromEntries(counts), websocket: Object.fromEntries(websocket)
		});
		try { output.write(line + '\n'); }
		catch { deferredFlushes++; return; }
		counts.clear();
		websocket.clear();
		deferredFlushes = 0;
		from = to;
	};
	return { observe, handshake, flush };
}
