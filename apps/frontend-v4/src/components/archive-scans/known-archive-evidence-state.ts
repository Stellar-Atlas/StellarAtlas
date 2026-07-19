import type {
	PublicHistoryArchiveObjectEventPage,
	PublicHistoryArchiveObjectPage,
	PublicKnownArchiveRemoteFailurePage,
	PublicKnownArchiveWorkerIssuePage
} from '@api/archive-evidence-types';
import {
	appendCursorPage,
	createCursorHistory,
	type CursorHistory
} from '@domain/archive-evidence-request-state';
import type { PublicKnownArchiveEvidence } from '@domain/known-archive-evidence';
import type {
	ArchiveEvidenceEventQuery,
	ArchiveEvidenceFailureQuery,
	ArchiveEvidenceObjectQuery
} from '@domain/known-archive-evidence-request';

export interface FailureCursorData {
	readonly remote: CursorHistory<PublicKnownArchiveRemoteFailurePage>;
	readonly worker: CursorHistory<PublicKnownArchiveWorkerIssuePage>;
}

export interface FailurePagesResponse {
	readonly remoteFailures: PublicKnownArchiveRemoteFailurePage;
	readonly workerIssues: PublicKnownArchiveWorkerIssuePage;
}

export type ObjectCursorData = CursorHistory<PublicHistoryArchiveObjectPage>;
export type EventCursorData =
	CursorHistory<PublicHistoryArchiveObjectEventPage>;
export type FailureRequestTarget = 'both' | 'remote' | 'worker';
export type ArchiveEvidenceViewKey = 'activity' | 'failures' | 'objects';

export function getInitialFailureQuery(
	evidence: PublicKnownArchiveEvidence
): ArchiveEvidenceFailureQuery {
	return {
		archiveUrl: resolveArchiveUrl(
			evidence,
			evidence.remoteFailures.filters.archiveUrlIdentity
		),
		objectType: evidence.remoteFailures.filters.objectType
	};
}

export function getInitialObjectQuery(
	evidence: PublicKnownArchiveEvidence
): ArchiveEvidenceObjectQuery {
	return {
		archiveUrl: resolveArchiveUrl(
			evidence,
			evidence.objectPage.filters.archiveUrlIdentity
		),
		objectType: evidence.objectPage.filters.objectType,
		status: evidence.objectPage.filters.status ?? 'pending'
	};
}

export function getInitialEventQuery(
	evidence: PublicKnownArchiveEvidence
): ArchiveEvidenceEventQuery {
	return {
		archiveUrl: resolveArchiveUrl(
			evidence,
			evidence.eventPage.filters.archiveUrlIdentity
		),
		evidenceClass: evidence.eventPage.filters.evidenceClass,
		objectType: evidence.eventPage.filters.objectType
	};
}

export function getInitialRepairArchiveUrl(
	evidence: PublicKnownArchiveEvidence
): string | null {
	return evidence.roots.length === 1
		? (evidence.roots[0]?.archiveUrl ?? null)
		: null;
}

export function mergeFailurePages(
	current: FailureCursorData | null,
	response: FailurePagesResponse,
	target: FailureRequestTarget
): FailureCursorData {
	if (current === null || target === 'both') {
		return {
			remote: createCursorHistory(response.remoteFailures),
			worker: createCursorHistory(response.workerIssues)
		};
	}
	return {
		remote:
			target === 'remote'
				? appendCursorPage(current.remote, response.remoteFailures)
				: current.remote,
		worker:
			target === 'worker'
				? appendCursorPage(current.worker, response.workerIssues)
				: current.worker
	};
}

function resolveArchiveUrl(
	evidence: PublicKnownArchiveEvidence,
	archiveUrlIdentity: string | null
): string | null {
	if (archiveUrlIdentity === null) return null;
	return (
		evidence.roots.find(
			(root) => root.archiveUrlIdentity === archiveUrlIdentity
		)?.archiveUrl ?? null
	);
}
