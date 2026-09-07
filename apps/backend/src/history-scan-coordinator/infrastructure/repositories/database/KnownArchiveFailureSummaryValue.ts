import type { KnownArchiveFailureSummaryV1 } from 'shared';

export const unavailableArchiveFailureSummary: KnownArchiveFailureSummaryV1 = {
	status: 'unavailable',
	computedAt: null,
	groups: [],
	limit: 20,
	totalGroups: null,
	remainingGroupCount: null,
	remainingFailureCount: null,
	remoteFailureCount: null,
	workerIssueCount: null
};

export function emptyArchiveFailureSummary(
	computedAt: Date,
	workerIssueCount = 0
): KnownArchiveFailureSummaryV1 {
	return {
		attributionVersion: 1,
		archiveFaultCount: 0,
		inconclusiveFailureCount: 0,
		inconclusiveAffectedCheckpointCount: 0,
		status: 'current',
		computedAt: computedAt.toISOString(),
		groups: [],
		limit: 20,
		totalGroups: 0,
		remainingGroupCount: 0,
		remainingFailureCount: 0,
		remoteFailureCount: 0,
		workerIssueCount,
		knownAffectedCheckpointCount: 0,
		unknownCheckpointFailureCount: 0
	};
}
