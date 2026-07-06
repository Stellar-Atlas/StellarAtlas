import type {
	PublicHistoryArchiveBucketCrossCoverage,
	PublicHistoryArchiveEvidence,
	PublicHistoryArchiveObjectEvents,
	PublicHistoryArchiveObjectQueue
} from './types';
import { fetchJson, type FetchOptions } from './client';
import { frontendCacheTags } from './cache-policy';

interface HistoryArchiveEvidenceOptions {
	readonly eventLimit?: number;
	readonly objectLimit?: number;
}

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
	evidenceOptions: HistoryArchiveEvidenceOptions = {},
	options?: FetchOptions
): Promise<PublicHistoryArchiveEvidence> => {
	const searchParams = new URLSearchParams();
	if (evidenceOptions.objectLimit !== undefined) {
		searchParams.set('objectLimit', evidenceOptions.objectLimit.toString());
	}
	if (evidenceOptions.eventLimit !== undefined) {
		searchParams.set('eventLimit', evidenceOptions.eventLimit.toString());
	}
	const queryString = searchParams.toString();
	const query = queryString.length > 0 ? `?${queryString}` : '';

	return fetchJson<PublicHistoryArchiveEvidence>(
		`/v1/archive-scans/${encodeURIComponent(historyUrl)}/object-evidence${query}`,
		withHistoryScanTags(options)
	);
};

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
