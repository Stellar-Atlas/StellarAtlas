import type { PublicHistoryArchiveObjectSummary } from '@api/types';
import { formatInteger } from '@format/formatters';

export function checkpointProofIsComplete(
	summary: PublicHistoryArchiveObjectSummary
): boolean {
	const checkpoints = summary.checkpoints;
	return (
		checkpoints.expectedArchiveCheckpoints > 0 &&
		checkpoints.categoryConsistentArchiveCheckpoints ===
			checkpoints.expectedArchiveCheckpoints &&
		checkpoints.categoryConsistencyFailedCheckpoints === 0 &&
		checkpoints.categoryConsistencyPendingCheckpoints === 0 &&
		checkpoints.categoryConsistencyNotEvaluatedCheckpoints === 0 &&
		checkpoints.missingArchiveCheckpoints === 0
	);
}

export function getPendingBucketCheckCount(
	summary: PublicHistoryArchiveObjectSummary
): number {
	return summary.buckets.pendingBucketObjects + summary.buckets.activeBucketObjects;
}

export function formatCheckpointProofWaitText(
	summary: PublicHistoryArchiveObjectSummary
): string {
	const pendingBuckets = getPendingBucketCheckCount(summary);
	if (
		summary.checkpoints.categoryConsistencyNotEvaluatedCheckpoints > 0 &&
		pendingBuckets > 0
	) {
		return `No failed archive files are visible in this snapshot. Checkpoint proof is waiting on ${formatInteger(pendingBuckets)} bucket copy checks.`;
	}

	return 'No failed archive files are visible in this snapshot. Checkpoint proof is still collecting cross-file evidence.';
}
