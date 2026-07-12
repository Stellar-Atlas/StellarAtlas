import type {
	HistoryArchiveObjectEventTypeV1,
	HistoryArchiveObjectEvidenceClassV1,
	HistoryArchiveObjectStatusV1,
	HistoryArchiveObjectTypeV1
} from 'shared';
import type {
	KnownArchiveEvidenceCursor,
	KnownArchiveFailurePageRequest,
	KnownArchiveObjectEventPageRequest,
	KnownArchiveObjectPageRequest
} from '../../domain/known-archive-evidence/KnownArchiveEvidenceRepository.js';
import { getHistoryArchiveUrlIdentity } from '../../domain/ArchiveUrlIdentity.js';
import {
	ArchiveEvidenceCursorCodec,
	type ArchiveEvidenceCursorKind,
	type DecodedArchiveEvidenceCursor
} from './ArchiveEvidenceCursorCodec.js';

export const defaultArchiveEvidencePageLimit = 25;
export const maxArchiveEvidencePageLimit = 250;
export const defaultArchiveEvidenceCopyLimit = 3;
export const maxArchiveEvidenceCopyLimit = 10;

export interface ArchiveEvidencePageOptions {
	readonly archiveUrl?: string;
	readonly copyLimit?: number;
	readonly eventCursor?: string;
	readonly eventEvidenceClass?: HistoryArchiveObjectEvidenceClassV1;
	readonly eventLimit?: number;
	readonly eventObjectType?: HistoryArchiveObjectTypeV1;
	readonly eventType?: HistoryArchiveObjectEventTypeV1;
	readonly failureCursor?: string;
	readonly failureLimit?: number;
	readonly failureObjectType?: HistoryArchiveObjectTypeV1;
	readonly objectCursor?: string;
	readonly objectLimit?: number;
	readonly objectStatus?: HistoryArchiveObjectStatusV1;
	readonly objectType?: HistoryArchiveObjectTypeV1;
	readonly workerIssueCursor?: string;
	readonly workerIssueLimit?: number;
}

export interface NormalizedArchiveEvidencePages {
	readonly copyLimit: number;
	readonly cursorScope: readonly string[];
	readonly eventPage: KnownArchiveObjectEventPageRequest;
	readonly objectPage: KnownArchiveObjectPageRequest;
	readonly remoteFailures: KnownArchiveFailurePageRequest;
	readonly snapshotAt: Date;
	readonly workerIssues: KnownArchiveFailurePageRequest;
}

export class InvalidArchiveEvidenceCursorError extends Error {
	constructor() {
		super('Invalid archive evidence cursor');
	}
}

export class InvalidArchiveEvidenceFilterError extends Error {
	constructor() {
		super('Invalid archive evidence filter');
	}
}

export function normalizeArchiveEvidencePages(
	options: ArchiveEvidencePageOptions,
	cursorCodec: ArchiveEvidenceCursorCodec,
	fixedArchiveUrlIdentity: string | null = null,
	cursorScope: readonly string[] = [],
	now: Date = new Date()
): NormalizedArchiveEvidencePages {
	const normalizedCursorScope = [...new Set(cursorScope)].toSorted();
	const archiveUrlIdentity = getFilteredArchiveUrlIdentity(
		options.archiveUrl,
		fixedArchiveUrlIdentity
	);
	const objectFilters = {
		archiveUrlIdentity,
		objectType: options.objectType ?? null,
		status: options.objectStatus ?? null
	};
	const eventFilters = {
		archiveUrlIdentity,
		evidenceClass: options.eventEvidenceClass ?? null,
		eventType: options.eventType ?? null,
		objectType: options.eventObjectType ?? null
	};
	const failureFilters = {
		archiveUrlIdentity,
		objectType: options.failureObjectType ?? null
	};
	const decoded = {
		events: decodeCursor(
			cursorCodec,
			'events',
			eventFilters,
			options.eventCursor,
			normalizedCursorScope
		),
		objects: decodeCursor(
			cursorCodec,
			'objects',
			objectFilters,
			options.objectCursor,
			normalizedCursorScope
		),
		remoteFailures: decodeCursor(
			cursorCodec,
			'remote-failures',
			failureFilters,
			options.failureCursor,
			normalizedCursorScope
		),
		workerIssues: decodeCursor(
			cursorCodec,
			'worker-issues',
			failureFilters,
			options.workerIssueCursor,
			normalizedCursorScope
		)
	};
	const snapshotAt = now;

	return {
		copyLimit: normalizeLimit(
			options.copyLimit,
			defaultArchiveEvidenceCopyLimit,
			maxArchiveEvidenceCopyLimit
		),
		cursorScope: normalizedCursorScope,
		eventPage: {
			before: toPosition(decoded.events),
			filters: eventFilters,
			limit: normalizePageLimit(options.eventLimit),
			snapshotAt,
			snapshotTotal: null
		},
		objectPage: {
			before: toPosition(decoded.objects),
			filters: objectFilters,
			limit: normalizePageLimit(options.objectLimit),
			snapshotAt,
			snapshotTotal: null
		},
		remoteFailures: {
			before: toPosition(decoded.remoteFailures),
			filters: failureFilters,
			limit: normalizePageLimit(options.failureLimit),
			snapshotAt,
			snapshotTotal: null
		},
		snapshotAt,
		workerIssues: {
			before: toPosition(decoded.workerIssues),
			filters: failureFilters,
			limit: normalizePageLimit(options.workerIssueLimit),
			snapshotAt,
			snapshotTotal: null
		}
	};
}

export function encodeArchiveEvidenceCursor(
	cursorCodec: ArchiveEvidenceCursorCodec,
	kind: ArchiveEvidenceCursorKind,
	filters: object,
	cursor: KnownArchiveEvidenceCursor,
	cursorScope: readonly string[]
): string {
	return cursorCodec.encode({
		filters,
		kind,
		position: cursor,
		rootScope: cursorScope
	});
}

function decodeCursor(
	cursorCodec: ArchiveEvidenceCursorCodec,
	kind: ArchiveEvidenceCursorKind,
	filters: object,
	value: string | undefined,
	cursorScope: readonly string[]
): DecodedArchiveEvidenceCursor | null {
	if (value === undefined) return null;
	const decoded = cursorCodec.decode({
		filters,
		kind,
		rootScope: cursorScope,
		token: value
	});
	if (decoded === null) throw new InvalidArchiveEvidenceCursorError();
	return decoded;
}

function getFilteredArchiveUrlIdentity(
	archiveUrl: string | undefined,
	fixedArchiveUrlIdentity: string | null
): string | null {
	if (fixedArchiveUrlIdentity !== null) return fixedArchiveUrlIdentity;
	if (archiveUrl === undefined) return null;
	const identity = getHistoryArchiveUrlIdentity(archiveUrl);
	if (identity === null) throw new InvalidArchiveEvidenceFilterError();
	return identity;
}

function toPosition(
	cursor: DecodedArchiveEvidenceCursor | null
): KnownArchiveEvidenceCursor | null {
	return cursor === null ? null : { at: cursor.at, remoteId: cursor.remoteId };
}

function normalizePageLimit(value: number | undefined): number {
	return normalizeLimit(
		value,
		defaultArchiveEvidencePageLimit,
		maxArchiveEvidencePageLimit
	);
}

function normalizeLimit(
	value: number | undefined,
	defaultValue: number,
	maxValue: number
): number {
	if (value === undefined || !Number.isSafeInteger(value) || value < 1) {
		return defaultValue;
	}
	return Math.min(value, maxValue);
}
