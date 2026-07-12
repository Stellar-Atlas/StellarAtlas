import type {
	PublicHistoryArchiveObjectEvidenceClass,
	PublicHistoryArchiveObjectStatus,
	PublicHistoryArchiveObjectType
} from '../api/archive-evidence-types';

export type ArchiveEvidenceSubject =
	| { readonly id: string; readonly kind: 'archive' }
	| { readonly id: string; readonly kind: 'node' }
	| { readonly id: string; readonly kind: 'organization' };

export interface ArchiveEvidenceFailureQuery {
	readonly archiveUrl: string | null;
	readonly objectType: PublicHistoryArchiveObjectType | null;
}

export interface ArchiveEvidenceObjectQuery {
	readonly archiveUrl: string | null;
	readonly objectType: PublicHistoryArchiveObjectType | null;
	readonly status: PublicHistoryArchiveObjectStatus;
}

export interface ArchiveEvidenceEventQuery {
	readonly archiveUrl: string | null;
	readonly evidenceClass: PublicHistoryArchiveObjectEvidenceClass | null;
	readonly objectType: PublicHistoryArchiveObjectType | null;
}

export interface ArchiveEvidenceFailurePageRequest extends ArchiveEvidenceFailureQuery {
	readonly failureCursor: string | null;
	readonly requestGeneration: number;
	readonly subject: ArchiveEvidenceSubject;
	readonly workerIssueCursor: string | null;
}

export interface ArchiveEvidenceObjectPageRequest extends ArchiveEvidenceObjectQuery {
	readonly cursor: string | null;
	readonly requestGeneration: number;
	readonly subject: ArchiveEvidenceSubject;
}

export interface ArchiveEvidenceEventPageRequest extends ArchiveEvidenceEventQuery {
	readonly cursor: string | null;
	readonly requestGeneration: number;
	readonly subject: ArchiveEvidenceSubject;
}

export interface ArchiveEvidenceActionMetadata {
	readonly evidenceGeneratedAt: string;
	readonly querySignature: string;
	readonly requestGeneration: number;
}

export type ArchiveEvidenceActionResult<Data> =
	| (ArchiveEvidenceActionMetadata & {
			readonly data: Data;
			readonly message: null;
			readonly status: 'loaded';
	  })
	| (Omit<ArchiveEvidenceActionMetadata, 'evidenceGeneratedAt'> & {
			readonly data: null;
			readonly evidenceGeneratedAt: null;
			readonly message: string;
			readonly status: 'invalid' | 'unavailable';
	  });

export function failureQuerySignature(
	subject: ArchiveEvidenceSubject,
	query: ArchiveEvidenceFailureQuery
): string {
	return signature('failures', subject, [query.archiveUrl, query.objectType]);
}

export function objectQuerySignature(
	subject: ArchiveEvidenceSubject,
	query: ArchiveEvidenceObjectQuery
): string {
	return signature('objects', subject, [
		query.archiveUrl,
		query.objectType,
		query.status
	]);
}

export function eventQuerySignature(
	subject: ArchiveEvidenceSubject,
	query: ArchiveEvidenceEventQuery
): string {
	return signature('events', subject, [
		query.archiveUrl,
		query.evidenceClass,
		query.objectType
	]);
}

function signature(
	kind: 'events' | 'failures' | 'objects',
	subject: ArchiveEvidenceSubject,
	values: readonly (string | null)[]
): string {
	return JSON.stringify({ kind, subject, values, version: 1 });
}
