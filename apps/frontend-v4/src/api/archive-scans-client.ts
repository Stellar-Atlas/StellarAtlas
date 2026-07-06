import type { PublicHistoryArchiveObjectEvents } from './types';
import { fetchJson, type FetchOptions } from './client';
import { frontendCacheTags } from './cache-policy';

export const fetchHistoryArchiveObjectEvents = (
	limit: number,
	options?: FetchOptions
): Promise<PublicHistoryArchiveObjectEvents> =>
	fetchJson<PublicHistoryArchiveObjectEvents>(
		`/v1/archive-scans/objects/events?limit=${encodeURIComponent(limit.toString())}`,
		withHistoryScanTags(options)
	);

export const fetchHistoryArchiveObjectEventsForArchive = (
	historyUrl: string,
	limit: number,
	options?: FetchOptions
): Promise<PublicHistoryArchiveObjectEvents> =>
	fetchJson<PublicHistoryArchiveObjectEvents>(
		`/v1/archive-scans/${encodeURIComponent(historyUrl)}/objects/events?limit=${encodeURIComponent(limit.toString())}`,
		withHistoryScanTags(options)
	);

function withHistoryScanTags(options: FetchOptions | undefined): FetchOptions {
	return {
		...options,
		tags: [frontendCacheTags.historyScan, ...(options?.tags ?? [])]
	};
}
