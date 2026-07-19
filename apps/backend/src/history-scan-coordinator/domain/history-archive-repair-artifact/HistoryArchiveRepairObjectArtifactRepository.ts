import type { Readable } from 'node:stream';

export type HistoryArchiveRepairObjectRepresentation =
	'canonical-json' | 'uncompressed-xdr';

export interface HistoryArchiveRepairObjectArtifactInput {
	readonly archiveUrl: string;
	readonly archiveUrlIdentity: string;
	readonly contentDigest: string;
	readonly contentRepresentation: HistoryArchiveRepairObjectRepresentation;
	readonly objectIdentity: string;
	readonly objectUrl: string;
}

export type HistoryArchiveRepairObjectArtifactUnavailableReason =
	| 'content-hash-mismatch'
	| 'invalid-compressed-payload'
	| 'invalid-object-identity'
	| 'remote-fetch-failed'
	| 'remote-payload-too-large'
	| 'remote-response-invalid'
	| 'staging-storage-unavailable'
	| 'verification-busy'
	| 'verification-timeout';

export interface HistoryArchiveRepairObjectArtifactUnavailable {
	readonly reason: HistoryArchiveRepairObjectArtifactUnavailableReason;
	readonly retryAfterSeconds: number | null;
	readonly retryable: boolean;
	readonly status: 'unavailable';
}

export interface OpenHistoryArchiveRepairObjectArtifact {
	readonly byteLength: number;
	readonly close: () => Promise<void>;
	readonly contentDigest: string;
	readonly contentRepresentation: HistoryArchiveRepairObjectRepresentation;
	readonly fileName: string;
	readonly mediaType: 'application/gzip' | 'application/json';
	readonly objectIdentity: string;
	readonly provenAt: Date;
	readonly status: 'available';
	readonly stream: Readable;
}

export type OpenHistoryArchiveRepairObjectArtifactResult =
	| OpenHistoryArchiveRepairObjectArtifact
	| HistoryArchiveRepairObjectArtifactUnavailable;

export interface HistoryArchiveRepairObjectArtifactRepository {
	openVerifiedObject(
		input: HistoryArchiveRepairObjectArtifactInput
	): Promise<OpenHistoryArchiveRepairObjectArtifactResult>;
}
