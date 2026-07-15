import type { Readable } from 'node:stream';

export const historyArchiveBucketHashPattern = /^[0-9a-f]{64}$/;

export type HistoryArchiveRepairArtifactUnavailableReason =
	| 'content-hash-mismatch'
	| 'invalid-compressed-payload'
	| 'invalid-object-identity'
	| 'local-payload-missing'
	| 'local-payload-not-regular'
	| 'local-payload-too-large'
	| 'local-storage-unavailable'
	| 'verification-busy'
	| 'verification-deferred'
	| 'verification-timeout';

export interface HistoryArchiveRepairArtifactUnavailable {
	readonly bucketHash: string | null;
	readonly reason: HistoryArchiveRepairArtifactUnavailableReason;
	readonly retryAfterSeconds: number | null;
	readonly retryable: boolean;
	readonly status: 'unavailable';
}

export interface HistoryArchiveRepairArtifactProof {
	readonly bucketHash: string;
	readonly byteLength: number;
	readonly provenAt: Date;
	readonly status: 'available';
}

export interface OpenHistoryArchiveRepairArtifact extends HistoryArchiveRepairArtifactProof {
	readonly close: () => Promise<void>;
	readonly stream: Readable;
}

export type HistoryArchiveRepairArtifactInspection =
	HistoryArchiveRepairArtifactProof | HistoryArchiveRepairArtifactUnavailable;

export type OpenHistoryArchiveRepairArtifactResult =
	OpenHistoryArchiveRepairArtifact | HistoryArchiveRepairArtifactUnavailable;

export interface HistoryArchiveRepairArtifactRepository {
	inspectBucket(
		bucketHash: string
	): Promise<HistoryArchiveRepairArtifactInspection>;
	openBucket(
		bucketHash: string
	): Promise<OpenHistoryArchiveRepairArtifactResult>;
}
