import type { ScpStatementObservation as CrawlerScpStatementObservation } from 'crawler';
import { compareScpStatementObservationPreference } from './ScpStatementObservationConflictPolicy.js';

export interface ScpStatementObservationRuntimePolicy {
	readonly databaseLockTimeoutMs: number;
	readonly databaseStatementTimeoutMs: number;
	readonly persistenceRetryInitialDelayMs: number;
	readonly persistenceRetryMaxDelayMs: number;
}

const positiveDecimal = /^[1-9]\d*$/;

export function resolveScpStatementObservationRuntimePolicy(
	environment: Readonly<Record<string, string | undefined>> = process.env
): ScpStatementObservationRuntimePolicy {
	const persistenceRetryInitialDelayMs = readBoundedPositiveInteger(
		environment.SCP_LIVE_PERSISTENCE_RETRY_INITIAL_DELAY_MS,
		'SCP_LIVE_PERSISTENCE_RETRY_INITIAL_DELAY_MS',
		250,
		50,
		60_000
	);
	const persistenceRetryMaxDelayMs = readBoundedPositiveInteger(
		environment.SCP_LIVE_PERSISTENCE_RETRY_MAX_DELAY_MS,
		'SCP_LIVE_PERSISTENCE_RETRY_MAX_DELAY_MS',
		30_000,
		250,
		300_000
	);
	if (persistenceRetryMaxDelayMs < persistenceRetryInitialDelayMs) {
		throw new Error(
			'SCP_LIVE_PERSISTENCE_RETRY_MAX_DELAY_MS must be greater than or equal to SCP_LIVE_PERSISTENCE_RETRY_INITIAL_DELAY_MS'
		);
	}

	return {
		databaseLockTimeoutMs: readBoundedPositiveInteger(
			environment.SCP_LIVE_DATABASE_LOCK_TIMEOUT_MS,
			'SCP_LIVE_DATABASE_LOCK_TIMEOUT_MS',
			2_000,
			100,
			10_000
		),
		databaseStatementTimeoutMs: readBoundedPositiveInteger(
			environment.SCP_LIVE_DATABASE_STATEMENT_TIMEOUT_MS,
			'SCP_LIVE_DATABASE_STATEMENT_TIMEOUT_MS',
			10_000,
			5_000,
			120_000
		),
		persistenceRetryInitialDelayMs,
		persistenceRetryMaxDelayMs
	};
}

const runtimePolicy = resolveScpStatementObservationRuntimePolicy();

export const scpStatementObservationPolicy = {
	cleanupBatchSize: 5_000,
	cleanupIntervalMs: 60_000,
	databaseLockTimeoutMs: runtimePolicy.databaseLockTimeoutMs,
	databaseStatementTimeoutMs: runtimePolicy.databaseStatementTimeoutMs,
	maxCleanupBatchesPerRun: 4,
	persistenceBatchSize: 250,
	persistenceFlushDelayMs: 250,
	persistenceMaxBufferedObservations: 10_000,
	persistenceRetryInitialDelayMs: runtimePolicy.persistenceRetryInitialDelayMs,
	persistenceRetryJitterRatio: 0.2,
	persistenceRetryMaxDelayMs: runtimePolicy.persistenceRetryMaxDelayMs,
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

function readBoundedPositiveInteger(
	value: string | undefined,
	name: string,
	fallback: number,
	minimum: number,
	maximum: number
): number {
	if (value === undefined) return fallback;
	if (!positiveDecimal.test(value)) {
		throw new Error(`${name} must be a positive decimal integer`);
	}

	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
		throw new Error(`${name} must be between ${minimum} and ${maximum}`);
	}
	return parsed;
}

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
