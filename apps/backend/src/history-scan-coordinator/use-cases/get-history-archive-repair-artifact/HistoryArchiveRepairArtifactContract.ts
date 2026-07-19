import type {
	HistoryArchiveRepairArtifactInspection,
	HistoryArchiveRepairArtifactPresence
} from '../../domain/history-archive-repair-artifact/HistoryArchiveRepairArtifactRepository.js';
import type {
	HistoryArchiveRepairArtifactAvailabilityV1,
	HistoryArchiveRepairArtifactContentHashV1,
	HistoryArchiveRepairArtifactUnavailableV1,
	HistoryArchiveRepairArtifactAvailableV1,
	HistoryArchiveRepairArtifactVerifyOnDownloadV1,
	HistoryArchiveObjectTypeV1,
	HistoryArchiveRepairActionV1,
	HistoryArchiveRepairPlanV1
} from 'shared';

export type {
	HistoryArchiveRepairArtifactAvailabilityV1,
	HistoryArchiveRepairArtifactAvailableV1,
	HistoryArchiveRepairArtifactContentHashV1,
	HistoryArchiveRepairArtifactUnavailableV1,
	HistoryArchiveRepairArtifactVerifyOnDownloadV1
} from 'shared';

export type HistoryArchiveRepairActionWithArtifactV1 =
	HistoryArchiveRepairActionV1;

export type HistoryArchiveRepairPlanResponseV1 = HistoryArchiveRepairPlanV1;

export const repairArtifactDownloadPath =
	'/v1/archive-scans/repair-artifacts/buckets';
export const repairObjectArtifactDownloadPath =
	'/v1/archive-scans/repair-artifacts/objects';

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

export function toPresentRepairArtifact(
	presence: HistoryArchiveRepairArtifactPresence,
	provenAt: Date
): HistoryArchiveRepairArtifactVerifyOnDownloadV1 {
	return {
		artifactType: 'bucket',
		byteLength: presence.byteLength,
		contentHash: contentHash(presence.bucketHash),
		downloadUrl: `${repairArtifactDownloadPath}/${presence.bucketHash}`,
		mediaType: 'application/gzip',
		objectIdentity: `bucket:${presence.bucketHash}`,
		provenAt: provenAt.toISOString(),
		status: 'verify-on-download'
	};
}

export function toRemoteRepairArtifact(input: {
	readonly artifactType: HistoryArchiveObjectTypeV1;
	readonly candidateRemoteId: string;
	readonly contentHash: HistoryArchiveRepairArtifactContentHashV1;
	readonly objectIdentity: string;
	readonly proofId: string;
	readonly proofVersion: number;
	readonly provenAt: string;
	readonly targetRemoteId: string;
}): HistoryArchiveRepairArtifactVerifyOnDownloadV1 {
	return {
		artifactType: input.artifactType,
		byteLength: null,
		contentHash: input.contentHash,
		downloadUrl: [
			repairObjectArtifactDownloadPath,
			encodeURIComponent(input.targetRemoteId),
			encodeURIComponent(input.candidateRemoteId),
			encodeURIComponent(input.proofId),
			String(input.proofVersion),
			String(new Date(input.provenAt).getTime()),
			input.contentHash.digest
		].join('/'),
		mediaType:
			input.contentHash.representation === 'canonical-json'
				? 'application/json'
				: 'application/gzip',
		objectIdentity: input.objectIdentity,
		provenAt: input.provenAt,
		status: 'verify-on-download'
	};
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
