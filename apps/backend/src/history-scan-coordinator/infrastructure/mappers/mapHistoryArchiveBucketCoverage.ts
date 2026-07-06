import type { HistoryArchiveObject } from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveObject.js';
import type {
	HistoryArchiveBucketArchiveRootV1,
	HistoryArchiveBucketCopyV1,
	HistoryArchiveBucketCrossCoverageV1,
	HistoryArchiveObjectStatusV1
} from 'shared';
import { sanitizePublicInfrastructureText } from './PublicScanErrorMapper.js';

export function mapHistoryArchiveBucketCoverage(
	bucketHash: string,
	objects: readonly HistoryArchiveObject[],
	generatedAt: Date
): HistoryArchiveBucketCrossCoverageV1 {
	const copies = objects.map(mapBucketCopy);

	return {
		archiveRoots: mapArchiveRoots(copies),
		bucketHash,
		counts: {
			archiveRoots: new Set(copies.map((copy) => copy.archiveUrlIdentity)).size,
			failedCopies: countStatus(copies, 'failed'),
			pendingCopies: countStatus(copies, 'pending'),
			scanningCopies: countStatus(copies, 'scanning'),
			totalCopies: copies.length,
			verifiedCopies: countStatus(copies, 'verified')
		},
		failedCopies: copies.filter((copy) => copy.status === 'failed'),
		generatedAt: generatedAt.toISOString(),
		pendingCopies: copies.filter((copy) => copy.status === 'pending'),
		scanningCopies: copies.filter((copy) => copy.status === 'scanning'),
		verifiedCopies: copies.filter((copy) => copy.status === 'verified')
	};
}

function mapBucketCopy(
	object: HistoryArchiveObject
): HistoryArchiveBucketCopyV1 {
	return {
		archiveUrl: object.archiveUrl,
		archiveUrlIdentity: object.archiveUrlIdentity,
		attempts: object.attempts,
		bytesDownloaded: toPublicNumber(object.bytesDownloaded),
		claimedAt: object.claimedAt?.toISOString() ?? null,
		error:
			object.errorMessage === null
				? null
				: {
						httpStatus: object.httpStatus,
						message: sanitizePublicInfrastructureText(object.errorMessage),
						type: object.errorType ?? 'error'
					},
		nextAttemptAt: object.nextAttemptAt?.toISOString() ?? null,
		objectKey: object.objectKey,
		objectUrl: object.objectUrl,
		remoteId: object.remoteId,
		status: object.status,
		updatedAt: requireDate(object.updatedAt).toISOString(),
		verifiedAt: object.verifiedAt?.toISOString() ?? null,
		workerStage: object.workerStage
	};
}

function mapArchiveRoots(
	copies: readonly HistoryArchiveBucketCopyV1[]
): readonly HistoryArchiveBucketArchiveRootV1[] {
	const rootsByIdentity = new Map<string, HistoryArchiveBucketArchiveRootV1>();
	for (const copy of copies) {
		if (rootsByIdentity.has(copy.archiveUrlIdentity)) continue;
		rootsByIdentity.set(copy.archiveUrlIdentity, {
			archiveUrl: copy.archiveUrl,
			archiveUrlIdentity: copy.archiveUrlIdentity,
			status: copy.status,
			updatedAt: copy.updatedAt,
			verifiedAt: copy.verifiedAt
		});
	}

	return Array.from(rootsByIdentity.values());
}

function countStatus(
	copies: readonly HistoryArchiveBucketCopyV1[],
	status: HistoryArchiveObjectStatusV1
): number {
	return copies.filter((copy) => copy.status === status).length;
}

function requireDate(value: Date | undefined): Date {
	if (value instanceof Date) return value;
	return new Date(0);
}

function toPublicNumber(value: number | string | null): number | null {
	if (value === null) return null;
	if (typeof value === 'number') return value;

	const parsed = Number(value);
	return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}
