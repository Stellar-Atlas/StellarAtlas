import type {
	PublicHistoryArchiveBucketCrossCoverage,
	PublicHistoryArchiveEvidence,
	PublicHistoryArchiveObjectEvents,
	PublicHistoryArchiveObjectQueue,
	PublicHistoryArchiveObjectSummary,
	PublicHistoryArchiveStatusSummary
} from './types';
import type { PublicHistoryArchiveRepairPlan } from './archive-repair-types';
import { fetchJson, type FetchOptions } from './client';
import { frontendCacheTags } from './cache-policy';
import type { KnownArchiveEvidenceQuery } from './known-archive-evidence-query';
import { parseHistoryArchiveEvidence } from './history-archive-evidence-parser';
import { buildHistoryArchiveEvidencePath } from './history-archive-evidence-path';
import { parseHistoryArchiveRepairPlan } from './history-archive-repair-plan-parser';

export const fetchHistoryArchiveObjectEvents = (
	limit: number,
	options?: FetchOptions
): Promise<PublicHistoryArchiveObjectEvents> =>
	fetchJson<PublicHistoryArchiveObjectEvents>(
		`/v1/archive-scans/objects/events?limit=${encodeURIComponent(limit.toString())}`,
		withHistoryScanTags(options)
	);

export const fetchHistoryArchiveObjectSummary = (
	options?: FetchOptions
): Promise<PublicHistoryArchiveObjectSummary> =>
	fetchJson<PublicHistoryArchiveObjectSummary>(
		'/v1/archive-scans/objects/summary',
		withHistoryScanTags(options)
	);

export const fetchHistoryArchiveObjectStatusSummary = (
	options?: FetchOptions
): Promise<PublicHistoryArchiveStatusSummary> =>
	fetchJson<PublicHistoryArchiveStatusSummary>(
		'/v1/archive-scans/objects/status-summary',
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

export const fetchHistoryArchiveBucketCoverage = (
	bucketHash: string,
	options?: FetchOptions
): Promise<PublicHistoryArchiveBucketCrossCoverage> =>
	fetchJson<PublicHistoryArchiveBucketCrossCoverage>(
		`/v1/archive-scans/objects/buckets/${encodeURIComponent(bucketHash)}/coverage`,
		withHistoryScanTags(options)
	);

export const fetchHistoryArchiveBucketCoveragesForObjects = async (
	objects: PublicHistoryArchiveObjectQueue,
	limit: number,
	options?: FetchOptions
): Promise<readonly PublicHistoryArchiveBucketCrossCoverage[]> => {
	const bucketHashes = getSampledBucketHashes(objects).slice(0, limit);
	const results = await Promise.allSettled(
		bucketHashes.map((bucketHash) =>
			fetchHistoryArchiveBucketCoverage(bucketHash, options)
		)
	);

	return results.flatMap((result) =>
		result.status === 'fulfilled' ? [result.value] : []
	);
};

export const fetchHistoryArchiveObjectEvidenceForArchive = (
	historyUrl: string,
	query: KnownArchiveEvidenceQuery = {},
	options?: FetchOptions
): Promise<PublicHistoryArchiveEvidence> =>
	fetchJson<unknown>(
		buildHistoryArchiveEvidencePath(historyUrl, query),
		withHistoryScanTags(options)
	).then(parseHistoryArchiveEvidence);

export const fetchHistoryArchiveRepairPlanForArchive = (
	historyUrl: string,
	limit = 100,
	options?: FetchOptions
): Promise<PublicHistoryArchiveRepairPlan> =>
	fetchJson<unknown>(
		`/v1/archive-scans/${encodeURIComponent(historyUrl)}/repair-plan?limit=${encodeURIComponent(limit.toString())}`,
		withHistoryScanTags(options)
	).then(parseHistoryArchiveRepairPlan);

function withHistoryScanTags(options: FetchOptions | undefined): FetchOptions {
	return {
		...options,
		tags: [frontendCacheTags.historyScan, ...(options?.tags ?? [])]
	};
}

function getSampledBucketHashes(
	objects: PublicHistoryArchiveObjectQueue
): readonly string[] {
	const bucketHashes = new Set<string>();
	for (const object of objects.objects) {
		if (object.bucketHash === null) continue;
		bucketHashes.add(object.bucketHash);
	}

	return Array.from(bucketHashes);
}
