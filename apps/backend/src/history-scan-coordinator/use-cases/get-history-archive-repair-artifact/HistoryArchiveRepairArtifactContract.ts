import type {
	HistoryArchiveRepairArtifactInspection,
	HistoryArchiveRepairArtifactUnavailableReason
} from '../../domain/history-archive-repair-artifact/HistoryArchiveRepairArtifactRepository.js';
import type {
	HistoryArchiveRepairActionV1,
	HistoryArchiveRepairPlanV1
} from 'shared';

export interface HistoryArchiveRepairArtifactContentHashV1 {
	readonly algorithm: 'sha256';
	readonly digest: string;
	readonly representation: 'uncompressed-xdr';
}

export interface HistoryArchiveRepairArtifactAvailableV1 {
	readonly artifactType: 'bucket';
	readonly byteLength: number;
	readonly contentHash: HistoryArchiveRepairArtifactContentHashV1;
	readonly downloadUrl: string;
	readonly mediaType: 'application/gzip';
	readonly objectIdentity: string;
	readonly provenAt: string;
	readonly status: 'available';
}

export interface HistoryArchiveRepairArtifactUnavailableV1 {
	readonly artifactType: 'bucket';
	readonly contentHash: HistoryArchiveRepairArtifactContentHashV1 | null;
	readonly objectIdentity: string | null;
	readonly reason: HistoryArchiveRepairArtifactUnavailableReason;
	readonly retry: {
		readonly afterSeconds: number | null;
		readonly retryable: boolean;
	};
	readonly status: 'unavailable';
}

export type HistoryArchiveRepairArtifactAvailabilityV1 =
	| HistoryArchiveRepairArtifactAvailableV1
	| HistoryArchiveRepairArtifactUnavailableV1;

export type HistoryArchiveRepairActionWithArtifactV1 =
	HistoryArchiveRepairActionV1 & {
		readonly repairArtifact: HistoryArchiveRepairArtifactAvailabilityV1 | null;
	};

export type HistoryArchiveRepairPlanResponseV1 = Omit<
	HistoryArchiveRepairPlanV1,
	'actions'
> & {
	readonly actions: readonly HistoryArchiveRepairActionWithArtifactV1[];
};

export const repairArtifactDownloadPath =
	'/v1/archive-scans/repair-artifacts/buckets';

export function toRepairArtifactAvailability(
	inspection: HistoryArchiveRepairArtifactInspection
): HistoryArchiveRepairArtifactAvailabilityV1 {
	if (inspection.status === 'unavailable') {
		return {
			artifactType: 'bucket',
			contentHash:
				inspection.bucketHash === null
					? null
					: contentHash(inspection.bucketHash),
			objectIdentity:
				inspection.bucketHash === null
					? null
					: `bucket:${inspection.bucketHash}`,
			reason: inspection.reason,
			retry: {
				afterSeconds: inspection.retryAfterSeconds,
				retryable: inspection.retryable
			},
			status: 'unavailable'
		};
	}

	return {
		artifactType: 'bucket',
		byteLength: inspection.byteLength,
		contentHash: contentHash(inspection.bucketHash),
		downloadUrl: `${repairArtifactDownloadPath}/${inspection.bucketHash}`,
		mediaType: 'application/gzip',
		objectIdentity: `bucket:${inspection.bucketHash}`,
		provenAt: inspection.provenAt.toISOString(),
		status: 'available'
	};
}

export function deferredRepairArtifact(
	bucketHash: string
): HistoryArchiveRepairArtifactUnavailableV1 {
	return toRepairArtifactAvailability({
		bucketHash,
		reason: 'verification-deferred',
		retryAfterSeconds: 5,
		retryable: true,
		status: 'unavailable'
	}) as HistoryArchiveRepairArtifactUnavailableV1;
}

function contentHash(
	bucketHash: string
): HistoryArchiveRepairArtifactContentHashV1 {
	return {
		algorithm: 'sha256',
		digest: bucketHash,
		representation: 'uncompressed-xdr'
	};
}
