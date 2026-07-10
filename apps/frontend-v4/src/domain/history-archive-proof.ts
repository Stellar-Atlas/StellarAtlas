import type { PublicHistoryArchiveObjectSummary } from '@api/types';
import { formatInteger } from '@format/formatters';
export { checkpointProofIsComplete } from './history-archive-health';

export function getPendingBucketCheckCount(
	summary: PublicHistoryArchiveObjectSummary
): number {
	return (
		summary.buckets.pendingBucketObjects + summary.buckets.activeBucketObjects
	);
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
