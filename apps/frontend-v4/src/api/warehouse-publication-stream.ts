import { buildBrowserRealtimeUrl } from './browser-client';

export interface WarehousePublication {
	readonly batchId: string;
	readonly minLedger: number;
	readonly maxLedger: number;
	readonly publishedAt: string;
	readonly datasets: readonly string[];
}
const listeners = new Set<(event: WarehousePublication) => void>();
let socket: WebSocket | null = null,
	retry: ReturnType<typeof setTimeout> | null = null,
	backoff = 1000;
const seen = new Set<string>();

/** One shared socket, only small publication signals. Rows are fetched as bounded cursor pages. */
export function subscribeWarehousePublication(
	listener: (event: WarehousePublication) => void
): () => void {
	listeners.add(listener);
	connect();
	return () => {
		listeners.delete(listener);
		if (!listeners.size) {
			if (retry) clearTimeout(retry);
			retry = null;
			const current = socket;
			socket = null;
			current?.close();
			seen.clear();
		}
	};
}
function connect(): void {
	if (socket || retry || !listeners.size) return;
	const current = new WebSocket(buildBrowserRealtimeUrl('/v1/stream/data'));
	socket = current;
	current.onopen = () => {
		backoff = 1000;
	};
	current.onmessage = (message) => {
		if (typeof message.data !== 'string' || message.data.length > 4096) return;
		try {
			const value = JSON.parse(message.data) as Record<string, unknown>;
			if (
				value.version !== 1 ||
				value.event !== 'datasets.published' ||
				typeof value.batchId !== 'string' ||
				typeof value.publishedAt !== 'string' ||
				!Number.isSafeInteger(value.minLedger) ||
				!Number.isSafeInteger(value.maxLedger) ||
				!Array.isArray(value.datasets) ||
				value.datasets.length > 32 ||
				!value.datasets.every((dataset) => typeof dataset === 'string')
			)
				return;
			if (seen.has(value.batchId)) return;
			seen.add(value.batchId);
			while (seen.size > 256) seen.delete(seen.values().next().value!);
			const event = value as unknown as WarehousePublication;
			for (const listener of listeners) listener(event);
		} catch {
			/* Invalid input is never rendered or replayed. */
		}
	};
	current.onerror = () => current.close();
	current.onclose = () => {
		if (socket !== current) return;
		socket = null;
		if (!listeners.size) return;
		retry = setTimeout(() => {
			retry = null;
			connect();
		}, backoff);
		backoff = Math.min(backoff * 2, 30000);
	};
}
