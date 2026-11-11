interface MirrorBinding {
	fetch(request: Request): Promise<Response>;
}

interface GatewayEnv {
	MIRROR: MirrorBinding;
	ORIGIN_HEADER_TIMEOUT_MS?: string;
	STATUS_HEADER_TIMEOUT_MS?: string;
}

type OriginFetch = (request: Request, init?: RequestInit) => Promise<Response>;
type PreviewOrigin = 'up' | 'down' | 'timeout' | undefined;

const SNAPSHOT_COOKIE =
	'atlas_snapshot=1; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=86400';
const CLEAR_COOKIE =
	'atlas_snapshot=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0';
const CORE_PREFIXES = [
	'/overview', '/graph', '/network', '/nodes', '/organizations', '/orgs',
	'/archives', '/archive-scans', '/status', '/docs', '/api-docs', '/explorer'
];

function corePath(path: string): boolean {
	return path === '/' || CORE_PREFIXES.some((prefix) =>
		path === prefix || path.startsWith(`${prefix}/`)
	);
}

// Only explicitly captured public reads qualify; never health or a catch-all API proxy.
function savedPublicReadPath(path: string): boolean {
	if (['/api/archive-inventory', '/v1', '/v1/asset-metadata', '/v1/nodes', '/v1/organizations',
		'/v1/known/nodes', '/v1/known/organizations', '/v1/search',
		'/v1/archive-scans/objects/status-summary', '/v1/scp/evidence/animation-backlog'].includes(path)) return true;
	return /^\/v1\/(?:analytics\/)?(?:assets(?:\/[^/]+(?:\/(?:holders|balances))?)?|issuers(?:\/[^/]+)?|accounts\/[^/]+\/balances|liquidity-pools(?:\/[^/]+)?)$/.test(path)
		|| /^\/v1\/(?:nodes|organizations)\/[^/]+$/.test(path)
		|| /^\/v1\/known\/(?:nodes|organizations)\/[^/]+(?:\/archive-evidence)?$/.test(path)
		|| /^\/v2\/archive-scans\/[^/]+\/object-evidence$/.test(path);
}

function milliseconds(value: string | undefined, fallback: number): number {
	if (!value || !/^\d+$/.test(value)) return fallback;
	return Math.max(100, Math.min(fallback, Number(value)));
}

function snapshotCookie(request: Request): boolean {
	return (request.headers.get('cookie') ?? '').split(';')
		.some((value) => value.trim() === 'atlas_snapshot=1');
}

function previewOrigin(url: URL): PreviewOrigin {
	if (!url.hostname.endsWith('.workers.dev')) return undefined;
	const mode = url.searchParams.get('__origin');
	return mode === 'up' || mode === 'timeout' ? mode : 'down';
}

function isRsc(request: Request, url: URL): boolean {
	return request.headers.get('rsc') === '1' ||
		(request.headers.get('accept') ?? '').includes('text/x-component') ||
		url.searchParams.has('_rsc');
}

function documentRequest(request: Request): boolean {
	const accept = (request.headers.get('accept') ?? '').trim().toLowerCase();
	return accept === '' || accept.includes('text/html') ||
		accept.split(',').some((value) => value.trim().split(';')[0] === '*/*') ||
		request.headers.get('sec-fetch-dest') === 'document';
}

function markSnapshot(response: Response, setCookie = false): Response {
	const headers = new Headers(response.headers);
	headers.set('Cache-Control', 'no-store');
	headers.set('X-StellarAtlas-Fallback', 'snapshot');
	if (setCookie || headers.get('content-type')?.includes('text/html')) {
		headers.append('Set-Cookie', SNAPSHOT_COOKIE);
	}
	return new Response(response.body, {
		status: response.status, statusText: response.statusText, headers
	});
}

function publicReadCors(headers: Headers): Headers {
	headers.set('Access-Control-Allow-Origin', '*');
	headers.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
	headers.set('Access-Control-Allow-Headers', 'Accept, Content-Type');
	headers.set('Access-Control-Expose-Headers', 'X-StellarAtlas-Fallback, X-StellarAtlas-Snapshot');
	return headers;
}

async function mirror(request: Request, env: GatewayEnv): Promise<Response> {
	try {
		// Affinity is consumed by the gateway before dispatch. Public snapshots
		// require no visitor cookies, including live OAuth and session credentials.
		if (request.headers.has('cookie')) {
			const headers = new Headers(request.headers);
			headers.delete('cookie');
			request = new Request(request, { headers });
		}
		const response = markSnapshot(await env.MIRROR.fetch(request));
		if (!savedPublicReadPath(new URL(request.url).pathname)) return response;
		return new Response(response.body, { status: response.status, statusText: response.statusText,
			headers: publicReadCors(new Headers(response.headers)) });
	} catch {
		return new Response('Snapshot unavailable', {
			status: 502, headers: { 'Cache-Control': 'no-store' }
		});
	}
}

// A deadline exists only on paths that already owned one in the deployed baseline.
// Undefined preserves raw-fetch wait semantics; emitted caller cancellation still propagates.
// Header deadlines never abort an accepted streaming body.
async function origin(
	request: Request, mode: PreviewOrigin, timeout: number | undefined, fetchOrigin: OriginFetch
): Promise<Response> {
	const controller = new AbortController();
	const cancel = () => controller.abort(request.signal.reason);
	if (request.signal.aborted) cancel();
	else request.signal.addEventListener('abort', cancel, { once: true });
	const timer = timeout === undefined ? undefined : setTimeout(() => controller.abort(), timeout);
	try {
		if (controller.signal.aborted) throw controller.signal.reason;
		if (mode === 'down') return new Response(null, { status: 503 });
		if (mode === 'timeout') {
			return await new Promise<Response>((_resolve, reject) => {
				controller.signal.addEventListener('abort', () =>
					reject(new Error('Origin header deadline exceeded')), { once: true });
			});
		}
		if (mode === 'up') {
			const url = new URL(request.url);
			url.hostname = 'stellaratlas.io';
			url.protocol = 'https:';
			url.port = '';
			url.searchParams.delete('__origin');
			request = new Request(url, request);
		}
		return await fetchOrigin(request, { signal: AbortSignal.any([controller.signal, request.signal]) });
	} finally {
		if (timer !== undefined) clearTimeout(timer);
		request.signal.removeEventListener('abort', cancel);
	}
}

async function modernOriginAvailable(request: Request, mode: PreviewOrigin, timeout: number, fetchOrigin: OriginFetch): Promise<boolean> {
	const controller = new AbortController();
	const cancel = () => controller.abort(request.signal.reason);
	const timer = setTimeout(() => controller.abort(), timeout);
	const interrupted = new Promise<never>((_resolve, reject) => {
		controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true });
	});
	void interrupted.catch(() => {});
	if (request.signal.aborted) cancel();
	else request.signal.addEventListener('abort', cancel, { once: true });
	let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
	let response: Response | undefined;
	try {
		if (mode === 'down' || controller.signal.aborted) return false;
		if (mode === 'timeout') return await interrupted;
		const url = new URL('/frontend-identity', request.url);
		if (mode === 'up') { url.hostname = 'stellaratlas.io'; url.protocol = 'https:'; url.port = ''; }
		const probe = new Request(url, { method: 'GET', redirect: 'manual', cache: 'no-store', signal: controller.signal,
			headers: { accept: 'application/json', 'cache-control': 'no-cache, no-store', pragma: 'no-cache' } });
		const pending = fetchOrigin(probe, { signal: controller.signal, redirect: 'manual', cache: 'no-store' }).then(value => {
			if (controller.signal.aborted) { void value.body?.cancel().catch(() => {}); throw controller.signal.reason; }
			return value;
		});
		response = await Promise.race([pending, interrupted]);
		if (response.status !== 200 || response.headers.has('x-stellaratlas-fallback') || response.headers.has('x-stellaratlas-snapshot') ||
			response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json' ||
			!response.headers.get('cache-control')?.toLowerCase().split(',').some(value => value.trim() === 'no-store') || !response.body) return false;
		reader = response.body.getReader();
		const chunks: Uint8Array[] = []; let length = 0;
		while (true) {
			const part = await Promise.race([reader.read(), interrupted]);
			if (part.done) break;
			length += part.value.byteLength;
			if (length > 256) return false;
			chunks.push(part.value);
		}
		if (controller.signal.aborted) return false;
		const bytes = new Uint8Array(length); let offset = 0;
		for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
		const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
		return value?.application === 'stellaratlas-modern-frontend' && value?.contractVersion === 1 &&
			Object.keys(value).sort().join(',') === 'application,contractVersion';
	} catch { return false; }
	finally {
		clearTimeout(timer); request.signal.removeEventListener('abort', cancel);
		if (reader) { void reader.cancel().catch(() => {}); reader.releaseLock(); }
		else void response?.body?.cancel().catch(() => {});
	}
}

export function createGateway(fetchOrigin: OriginFetch) {
	return async function handle(request: Request, env: GatewayEnv): Promise<Response> {
		const url = new URL(request.url);
		const mode = previewOrigin(url);
		const timeout = milliseconds(env.ORIGIN_HEADER_TIMEOUT_MS, 8000);
		const originOnly = async (): Promise<Response> => {
			try { return await (mode === undefined ? fetchOrigin(request)
				: origin(request, mode, timeout, fetchOrigin)); }
			catch { return new Response('Origin unavailable', {
				status: 502, headers: { 'Cache-Control': 'no-store' }
			}); }
		};

		// Never disclose authenticated requests or upgraded connections to the mirror.
		if (request.headers.has('authorization') ||
			request.headers.get('upgrade')?.toLowerCase() === 'websocket') {
			return originOnly();
		}
		const read = request.method === 'GET' || request.method === 'HEAD';
		const pinned = snapshotCookie(request);
		const core = corePath(url.pathname);
		const action = request.method === 'POST' && request.headers.has('next-action');
		if (request.method === 'OPTIONS' && savedPublicReadPath(url.pathname)
			&& ['GET', 'HEAD'].includes(request.headers.get('access-control-request-method') ?? '')
			&& (request.headers.get('access-control-request-headers') ?? '').split(',')
				.every(name => ['', 'accept', 'content-type'].includes(name.trim().toLowerCase()))) {
			const response = await originOnly();
			if (response.status < 500) return response;
			await response.body?.cancel().catch(() => {});
			return markSnapshot(new Response(null, { status: 204, headers: publicReadCors(new Headers()) }));
		}
		if (!read) {
			// Only the already-pinned mirror's own read-only Next Action handler qualifies.
			return pinned && action && core ? mirror(request, env) : originOnly();
		}

		if (url.pathname === '/__failover/status') {
			const available = await modernOriginAvailable(request, mode,
				milliseconds(env.STATUS_HEADER_TIMEOUT_MS, 3000), fetchOrigin);
			const headers = new Headers({
				'Content-Type': 'application/json', 'Cache-Control': 'no-store'
			});
			if (available) headers.append('Set-Cookie', CLEAR_COOKIE);
			return new Response(request.method === 'HEAD' ? null :
				JSON.stringify({ available }), { headers });
		}

		if (url.pathname.startsWith('/api/snapshot/')) return mirror(request, env);
		if (savedPublicReadPath(url.pathname)) {
			if (pinned) return mirror(request, env);
			try {
				// Production saved reads previously used raw fetch on BOTH hosts. Do not
				// impose the queued 8s/67s cutoffs, including on aliases or HEAD.
				// Preview modes retain their existing diagnostic header deadline.
				const response = await origin(request, mode, mode === undefined ? undefined : timeout, fetchOrigin);
				if (response.status < 500) return response;
				await response.body?.cancel().catch(() => {});
			} catch { if (request.signal.aborted) throw request.signal.reason; }
			if (request.signal.aborted) throw request.signal.reason;
			return mirror(request, env);
		}
		const rsc = isRsc(request, url);
		const publicPage = core && (rsc || documentRequest(request));
		if (!publicPage) return originOnly();
		if (pinned) return mirror(request, env);

		try {
			const response = await origin(request, mode, timeout, fetchOrigin);
			if (response.status < 500) return response;
			await response.body?.cancel();
		} catch { if (request.signal.aborted) throw request.signal.reason; }
		if (request.signal.aborted) throw request.signal.reason;
		if (rsc) {
			// Next 16 treats non-RSC content as an MPA navigation. Never mix build payloads.
			return markSnapshot(new Response(null, {
				status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' }
			}), true);
		}
		return mirror(request, env);
	};
}

export default { fetch: createGateway((request, init) => fetch(request, init)) };
