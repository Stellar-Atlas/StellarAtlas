import type { ScpStatementObservation as CrawlerScpStatementObservation } from 'crawler';
import { compareScpStatementObservationPreference } from './ScpStatementObservationConflictPolicy.js';

export const scpStatementObservationPolicy = {
	cleanupBatchSize: 5_000,
	cleanupIntervalMs: 60_000,
	databaseLockTimeoutMs: 2_000,
	databaseStatementTimeoutMs: 10_000,
	maxCleanupBatchesPerRun: 4,
	persistenceBatchSize: 250,
	persistenceFlushDelayMs: 250,
	persistenceMaxBufferedObservations: 10_000,
	persistenceSaveTimeoutMs: 12_000,
	projectionBackfillBatchSize: 1_000,
	projectionBackfillTimeoutMs: 12_500,
	projectionBackfillWindowMs: 5 * 60 * 1_000,
	projectionBatchSize: 1_000,
	projectionEventRetentionMs: 5 * 60 * 1_000,
	projectionEventTailBatchSize: 1_000,
	projectionEventTailPollIntervalMs: 1_000,
	projectionEventTailTimeoutMs: 12_500,
	projectionCooldownMs: 30_000,
	projectionMaxOutstandingRequests: 2,
	projectionMaxPendingObservations: 5_000,
	projectionTaskReconciliationIntervalMs: 5_000,
	projectionTimeoutMs: 5_000,
	readFreshnessMs: 30_000,
	readFutureToleranceMs: 10_000,
	shutdownDrainTimeoutMs: 60_000,
	shutdownKernelBudgetMs: 10_000,
	shutdownSystemdHeadroomMs: 10_000,
	systemdStopTimeoutMs: 90_000,
	retentionMs: 24 * 60 * 60 * 1_000
} as const;

export function selectNewestScpStatementObservations(
	observations: readonly CrawlerScpStatementObservation[]
): CrawlerScpStatementObservation[] {
	const newestByHash = new Map<string, CrawlerScpStatementObservation>();
	for (const observation of observations) {
		const current = newestByHash.get(observation.statementHash);
		if (
			current === undefined ||
			compareScpStatementObservationPreference(observation, current) > 0
		) {
			newestByHash.set(observation.statementHash, observation);
		}
	}

	return [...newestByHash.values()]
		.sort(
			(left, right) =>
				left.observedAt.getTime() - right.observedAt.getTime() ||
				left.statementHash.localeCompare(right.statementHash)
		)
		.slice(-scpStatementObservationPolicy.projectionMaxPendingObservations);
}
