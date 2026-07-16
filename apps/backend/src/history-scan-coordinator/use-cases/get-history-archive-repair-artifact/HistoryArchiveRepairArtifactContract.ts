import type { HistoryArchiveRepairArtifactInspection } from '../../domain/history-archive-repair-artifact/HistoryArchiveRepairArtifactRepository.js';
import type {
	HistoryArchiveRepairArtifactAvailabilityV1,
	HistoryArchiveRepairArtifactContentHashV1,
	HistoryArchiveRepairArtifactUnavailableV1,
	HistoryArchiveRepairArtifactAvailableV1,
	HistoryArchiveRepairActionV1,
	HistoryArchiveRepairPlanV1
} from 'shared';

export type {
	HistoryArchiveRepairArtifactAvailabilityV1,
	HistoryArchiveRepairArtifactAvailableV1,
	HistoryArchiveRepairArtifactContentHashV1,
	HistoryArchiveRepairArtifactUnavailableV1
} from 'shared';

export type HistoryArchiveRepairActionWithArtifactV1 =
	HistoryArchiveRepairActionV1;

export type HistoryArchiveRepairPlanResponseV1 = HistoryArchiveRepairPlanV1;

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
