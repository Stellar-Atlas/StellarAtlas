export type AtlasApiOutcome = '2xx' | '3xx' | '4xx' | '5xx' | '429' | 'other' | 'aborted';
type Item = { readonly body: string; readonly queuedAt: number };
const capacity = 1024;
const concurrency = 8;
const maxAgeMs = 10_000;
const site = 'api.stellaratlas.io';
const routePattern = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) (\/[\w{}./-]{0,180})$/;
const fallbackLabels = new Set(['UNMATCHED_ROUTE', 'UNSUPPORTED_METHOD', 'INVALID_PATH']);
const methods = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

export interface AtlasApiEventSender {
	record(route: string, outcome: AtlasApiOutcome, method?: string): void;
	snapshot(): Readonly<Record<string, number>>;
	close(): Promise<void>;
}

function refusedBeforeConnection(error: unknown): boolean {
	return error !== null && typeof error === 'object' && 'cause' in error &&
		error.cause !== null && typeof error.cause === 'object' && 'code' in error.cause &&
		error.cause.code === 'ECONNREFUSED';
}

/** Private CE receiver only; never forwards client identities or impersonates a browser. */
export function createAtlasApiEventSender(
	environment: NodeJS.ProcessEnv, send: typeof fetch = fetch
): AtlasApiEventSender | undefined {
	const origin = environment.ATLAS_API_PLAUSIBLE_ORIGIN;
	if (!origin) return;
	if (origin !== 'http://127.0.0.1:18080') throw new Error('API events require the private local Plausible receiver');
	const endpoint = origin + '/api/event';
	const queue = new Array<Item | undefined>(capacity);
	const active = new Set<AbortController>();
	const counts = { enqueued: 0, accepted: 0, failed: 0, collectorDropped: 0, rejected: 0,
		ambiguous: 0, overloaded: 0, expired: 0, retried: 0, shutdownDropped: 0, shutdownInFlight: 0 };
	let head = 0, tail = 0, size = 0;
	let scheduled = false, accepting = true, stopped = false;
	let idle: (() => void) | undefined;
	let closing: Promise<void> | undefined;
	const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

	async function deliver(item: Item, controller: AbortController): Promise<void> {
		for (let attempt = 0; attempt < 2; attempt++) {
			try {
				const response = await send(endpoint, {
					method: 'POST', redirect: 'error', credentials: 'omit',
					headers: { 'Content-Type': 'application/json', 'User-Agent': 'StellarAtlasAPIEvents/1.0' },
					body: item.body,
					signal: AbortSignal.any([controller.signal, AbortSignal.timeout(2000)])
				});
				void response.body?.cancel().catch(() => {});
				const dropped = response.headers.get('x-plausible-dropped');
				if (response.status === 202 && (dropped === null || dropped === '0')) counts.accepted++;
				else {
					counts.failed++;
					if (dropped !== null && dropped !== '0') counts.collectorDropped++;
					else counts.rejected++;
				}
				return;
			} catch (error: unknown) {
				// No CE idempotency key exists. Retry only a failed local connection,
				// never a timeout, ambiguous response, HTTP rejection or collector drop.
				const refused = refusedBeforeConnection(error);
				if (refused && attempt === 0 && !controller.signal.aborted && !stopped &&
					performance.now() - item.queuedAt < maxAgeMs - 250) {
					counts.retried++;
					await delay(250);
					continue;
				}
				counts.failed++;
				if (refused) counts.rejected++;
				else counts.ambiguous++;
				return;
			}
		}
	}

	function pump(): void {
		scheduled = false;
		while (!stopped && size > 0 && active.size < concurrency) {
			const item = queue[head]!;
			queue[head] = undefined;
			head = (head + 1) % capacity;
			size--;
			if (performance.now() - item.queuedAt >= maxAgeMs) { counts.expired++; continue; }
			const controller = new AbortController();
			active.add(controller);
			void deliver(item, controller).finally(() => {
				active.delete(controller);
				schedule();
			});
		}
		if (size === 0 && active.size === 0) idle?.();
	}

	function schedule(): void {
		if (scheduled || stopped) return;
		scheduled = true;
		setImmediate(pump);
	}

	return {
		record(route, outcome, method): void {
			if (!accepting || size >= capacity) { counts.overloaded++; return; }
			const match = routePattern.exec(route);
			const label = match?.[2] ?? (fallbackLabels.has(route) ? route : 'UNMATCHED_ROUTE');
			queue[tail] = { queuedAt: performance.now(), body: JSON.stringify({
				name: 'API request', domain: site, url: 'https://' + site + '/requests', interactive: false,
				props: { route: label, method: match?.[1] ?? (method && methods.has(method) ? method : 'OTHER'),
					outcome, scope: 'origin_http' }
			}) };
			tail = (tail + 1) % capacity;
			size++;
			counts.enqueued++;
			schedule();
		},
		snapshot: () => ({ ...counts, pending: size, active: active.size }),
		close(): Promise<void> {
			if (closing) return closing;
			accepting = false;
			closing = (async () => {
				let timeout: ReturnType<typeof setTimeout> | undefined;
				await Promise.race([
					new Promise<void>(resolve => { idle = resolve; schedule(); }),
					new Promise<void>(resolve => { timeout = setTimeout(resolve, 2000); })
				]);
				clearTimeout(timeout);
				idle = undefined;
				stopped = true;
				counts.shutdownDropped += size;
				counts.shutdownInFlight += active.size;
				queue.fill(undefined);
				size = 0;
				for (const controller of active) controller.abort();
			})();
			return closing;
		}
	};
}
