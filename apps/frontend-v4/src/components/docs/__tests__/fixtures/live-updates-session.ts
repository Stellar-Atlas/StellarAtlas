interface ExampleSocket {
	onmessage?: (event: { data: unknown }) => void;
	onclose?: () => void;
	close(): void;
}
export interface LiveUpdatesEnvironment {
	readonly WebSocket: new (url: string) => ExampleSocket;
	readonly setTimeout: (callback: () => unknown, delay: number) => number;
	readonly clearTimeout: (id: number) => void;
	readonly fetch: (url: string, options: { signal: AbortSignal }) => Promise<{
		ok: boolean; status: number; json(): Promise<unknown>;
	}>;
	readonly console: {
		log(...values: unknown[]): void;
		error(...values: unknown[]): void;
		info(...values: unknown[]): void;
	};
}
interface Notice {
	version?: unknown;
	event?: unknown;
	batchId?: unknown;
	datasets?: unknown;
	minLedger?: number;
	maxLedger?: number;
}

/** Imported normally; the parity test verifies the entire displayed executable body. */
export function createLiveUpdatesSession(
	eventUrl: string, minLedger: number, maxLedger: number, environment: LiveUpdatesEnvironment
) {
	const { WebSocket, setTimeout, clearTimeout, fetch, console } = environment;
	const feed = new WebSocket('wss://api.stellaratlas.io/v1/stream/data');
	const seen = new Set<string>();
	let timer: number | null = null, request: AbortController | null = null, pending = false, stopped = false;

	function queueRefresh() {
		if (stopped || timer !== null || request !== null) return;
		timer = setTimeout(async () => {
			timer = null;
			if (stopped) return;
			pending = false;
			request = new AbortController();
			const deadline = setTimeout(() => request?.abort(), 10_000);
			try {
				const response = await fetch(eventUrl, { signal: request.signal });
				if (stopped) return;
				if (!response.ok) throw new Error('HTTP ' + response.status);
				const page = await response.json();
				if (stopped) return;
				console.log('Refreshed bounded event page:', page);
			} catch (error) {
				if (!stopped) console.error('Refresh failed; retain the previous page:', error);
			} finally {
				clearTimeout(deadline);
				request = null;
				if (pending) queueRefresh();
			}
		}, 250);
	}

	feed.onmessage = ({ data }) => {
		if (stopped || typeof data !== 'string' || data.length > 4096) return;
		let notice: Notice | null;
		try { notice = JSON.parse(data) as Notice | null; } catch { return; }
		if (notice?.version !== 1 || notice.event !== 'datasets.published' ||
			typeof notice.batchId !== 'string' || !Array.isArray(notice.datasets) ||
			!notice.datasets.includes('history_contract_events')) return;
		if (!Number.isSafeInteger(notice.minLedger) || !Number.isSafeInteger(notice.maxLedger) ||
			notice.minLedger! > notice.maxLedger!) return;
		if (notice.maxLedger! < minLedger || notice.minLedger! > maxLedger) return;
		if (seen.has(notice.batchId)) return;
		seen.add(notice.batchId);
		while (seen.size > 256) seen.delete(seen.values().next().value!);
		pending = true;
		queueRefresh();
	};
	feed.onclose = () => {
		if (!stopped) console.info('Disconnected; recheck coverage before reconnecting.');
	};

	function stopUpdates() {
		stopped = true;
		if (timer !== null) clearTimeout(timer);
		timer = null;
		pending = false;
		request?.abort();
		feed.close();
		seen.clear();
	}
	return { stop: stopUpdates, remembered: () => seen.size };
}
