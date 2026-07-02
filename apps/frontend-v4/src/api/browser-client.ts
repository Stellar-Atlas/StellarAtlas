import type {
	PublicHistoryArchiveScanLogEntry,
	PublicLedgerTransactions,
	PublicLatestLedger,
	PublicNetwork,
	PublicScpStatementObservation
} from './types';

interface BrowserScpStatementFetchOptions {
	readonly limit?: number;
	readonly nodeId?: string;
	readonly slotIndex?: string;
}

export const getBrowserApiBaseUrl = (): string => {
	const configuredUrl = process.env.NEXT_PUBLIC_STELLAR_ATLAS_API_URL?.trim();
	if (configuredUrl && configuredUrl.length > 0) {
		return configuredUrl.endsWith('/')
			? configuredUrl.slice(0, -1)
			: configuredUrl;
	}

	if (
		window.location.hostname === 'stellaratlas.io' ||
		window.location.hostname.endsWith('.stellaratlas.io')
	) {
		return 'https://api.stellaratlas.io';
	}

	if (
		window.location.hostname === 'localhost' ||
		window.location.hostname === '127.0.0.1'
	) {
		return 'http://127.0.0.1:3000';
	}

	return window.location.origin;
};

export const buildBrowserApiUrl = (
	path: string,
	cacheBust = false
): string => {
	const url = new URL(path, getBrowserApiBaseUrl());
	if (cacheBust) url.searchParams.set('refresh', Date.now().toString());
	return url.toString();
};

const fetchBrowserJson = async <Payload>(
	path: string,
	signal: AbortSignal,
	cacheBust = true
): Promise<Payload> => {
	const response = await fetch(buildBrowserApiUrl(path, cacheBust), {
		cache: 'no-store',
		headers: { Accept: 'application/json' },
		signal
	});

	if (!response.ok) throw new Error(`API request returned ${response.status}`);
	return response.json() as Promise<Payload>;
};

export const fetchBrowserPublicNetwork = (
	signal: AbortSignal
): Promise<PublicNetwork> => fetchBrowserJson<PublicNetwork>('/v1', signal);

export const fetchBrowserLedgerTransactions = (
	slotIndex: string,
	signal: AbortSignal
): Promise<PublicLedgerTransactions> =>
	fetchBrowserJson<PublicLedgerTransactions>(
		`/v1/scp/slots/${encodeURIComponent(slotIndex)}/transactions`,
		signal
	);

export const fetchBrowserLatestLedger = (
	signal: AbortSignal
): Promise<PublicLatestLedger> =>
	fetchBrowserJson<PublicLatestLedger>('/v1/ledger/latest', signal);

export const fetchBrowserHistoryArchiveScanLogs = (
	historyUrl: string,
	signal: AbortSignal
): Promise<PublicHistoryArchiveScanLogEntry[]> =>
	fetchBrowserJson<PublicHistoryArchiveScanLogEntry[]>(
		`/v1/history-scan/logs/${encodeURIComponent(historyUrl)}`,
		signal
	);

export const fetchBrowserScpStatements = (
	options: BrowserScpStatementFetchOptions,
	signal: AbortSignal
): Promise<PublicScpStatementObservation[]> => {
	const url = new URL('/v1/scp-statements', 'https://placeholder.invalid');
	if (options.limit !== undefined) {
		url.searchParams.set('limit', options.limit.toString());
	}
	if (options.nodeId !== undefined) url.searchParams.set('nodeId', options.nodeId);
	if (options.slotIndex !== undefined) {
		url.searchParams.set('slotIndex', options.slotIndex);
	}

	return fetchBrowserJson<PublicScpStatementObservation[]>(
		`${url.pathname}${url.search}`,
		signal
	);
};
