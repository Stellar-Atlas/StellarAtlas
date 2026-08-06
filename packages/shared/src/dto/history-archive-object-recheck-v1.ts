export type HistoryArchiveObjectRecheckStateV1 =
	'queued' | 'already-queued' | 'not-yet-eligible' | 'blocked';

export type HistoryArchiveObjectRecheckBlockedReasonV1 =
	| 'archive-work-already-queued'
	| 'dependency-not-ready'
	| 'evidence-revision-changed'
	| 'host-backoff'
	| 'non-remote-evidence-failure'
	| 'object-not-executable'
	| 'object-not-failed'
	| 'transition-effects-pending'
	| 'verified-object';

export type HistoryArchiveObjectRecheckReasonV1 =
	| 'eligible-remote-failure'
	| 'already-in-ready-queue'
	| 'retry-window'
	| HistoryArchiveObjectRecheckBlockedReasonV1;

interface HistoryArchiveObjectRecheckBaseV1 {
	readonly eligibleAt: string | null;
	readonly hostBackoffUntil: string | null;
	readonly remoteId: string;
}

export type HistoryArchiveObjectRecheckResponseV1 =
	| (HistoryArchiveObjectRecheckBaseV1 & {
			readonly reason: 'eligible-remote-failure';
			readonly state: 'queued';
	  })
	| (HistoryArchiveObjectRecheckBaseV1 & {
			readonly reason: 'already-in-ready-queue';
			readonly state: 'already-queued';
	  })
	| (HistoryArchiveObjectRecheckBaseV1 & {
			readonly reason: 'retry-window';
			readonly state: 'not-yet-eligible';
	  })
	| (HistoryArchiveObjectRecheckBaseV1 & {
			readonly reason: HistoryArchiveObjectRecheckBlockedReasonV1;
			readonly state: 'blocked';
	  });

export interface HistoryArchiveObjectRecheckErrorV1 {
	readonly error:
		| 'archive-object-not-found'
		| 'invalid-recheck-request'
		| 'invalid-remote-id';
	readonly remoteId: string;
}
