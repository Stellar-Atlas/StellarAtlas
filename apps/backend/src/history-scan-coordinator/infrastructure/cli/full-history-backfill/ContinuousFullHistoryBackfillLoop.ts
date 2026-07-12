import type { RunFullHistoryBackfillResult } from '../../../use-cases/run-full-history-backfill/RunFullHistoryBackfill.js';
import type { ScheduleFullHistoryBackfillResult } from '../../../use-cases/schedule-full-history-backfill/ScheduleFullHistoryBackfill.js';

export interface ContinuousFullHistoryBackfillLoopConfig {
	readonly errorBackoffMs: number;
	readonly evidenceRejectedBackoffMs: number;
	readonly heartbeatIntervalMs: number;
	readonly idleBackoffMs: number;
	readonly proofPendingBackoffMs: number;
	readonly successDelayMs: number;
}

export interface ContinuousFullHistoryBackfillCycleResult {
	readonly run: RunFullHistoryBackfillResult;
	readonly schedule: ScheduleFullHistoryBackfillResult;
}

export type ContinuousFullHistoryBackfillOutcome =
	RunFullHistoryBackfillResult['status'] | 'cycle-failed';

export type ContinuousFullHistoryBackfillLoopEvent =
	| {
			readonly at: string;
			readonly cycle: number;
			readonly event: 'heartbeat';
			readonly lastOutcome: ContinuousFullHistoryBackfillOutcome | null;
			readonly status: 'running';
	  }
	| {
			readonly at: string;
			readonly checkpointLedger?: number;
			readonly cycle: number;
			readonly durationMs: number;
			readonly event: 'outcome';
			readonly jobId?: string;
			readonly jobState?: string;
			readonly processedCheckpoints?: number;
			readonly retryInMs: number;
			readonly runStatus: RunFullHistoryBackfillResult['status'];
			readonly scheduleStatus: ScheduleFullHistoryBackfillResult['status'];
	  }
	| {
			readonly at: string;
			readonly cycle: number;
			readonly durationMs: number;
			readonly event: 'cycle-error';
			readonly message: string;
			readonly retryInMs: number;
	  };

export interface ContinuousFullHistoryBackfillLoopDependencies {
	readonly emit: (event: ContinuousFullHistoryBackfillLoopEvent) => void;
	readonly executeCycle: () => Promise<ContinuousFullHistoryBackfillCycleResult>;
	readonly formatError: (error: unknown) => string;
	readonly now: () => number;
	readonly shouldStop: () => boolean;
	readonly wait: (milliseconds: number) => Promise<void>;
}

export async function runContinuousFullHistoryBackfillLoop(
	config: ContinuousFullHistoryBackfillLoopConfig,
	dependencies: ContinuousFullHistoryBackfillLoopDependencies
): Promise<void> {
	let cycle = 0;
	let lastOutcome: ContinuousFullHistoryBackfillOutcome | null = null;
	let nextHeartbeatAt = dependencies.now() + config.heartbeatIntervalMs;
	dependencies.emit(heartbeat(dependencies.now(), cycle, lastOutcome));

	while (!dependencies.shouldStop()) {
		const startedAt = dependencies.now();
		let retryInMs: number;
		try {
			const result = await dependencies.executeCycle();
			cycle += 1;
			lastOutcome = result.run.status;
			retryInMs = backoffForResult(config, result.run);
			dependencies.emit(
				outcomeEvent(result, cycle, startedAt, dependencies.now(), retryInMs)
			);
		} catch (error) {
			cycle += 1;
			lastOutcome = 'cycle-failed';
			retryInMs = config.errorBackoffMs;
			const finishedAt = dependencies.now();
			dependencies.emit({
				at: new Date(finishedAt).toISOString(),
				cycle,
				durationMs: elapsedMilliseconds(startedAt, finishedAt),
				event: 'cycle-error',
				message: dependencies.formatError(error),
				retryInMs
			});
		}

		const finishedAt = dependencies.now();
		if (finishedAt >= nextHeartbeatAt) {
			dependencies.emit(heartbeat(finishedAt, cycle, lastOutcome));
			nextHeartbeatAt = finishedAt + config.heartbeatIntervalMs;
		}
		if (!dependencies.shouldStop()) await dependencies.wait(retryInMs);
	}
}

export function backoffForResult(
	config: ContinuousFullHistoryBackfillLoopConfig,
	result: RunFullHistoryBackfillResult
): number {
	switch (result.status) {
		case 'completed':
			return config.successDelayMs;
		case 'evidence-rejected':
			return config.evidenceRejectedBackoffMs;
		case 'idle':
			return config.idleBackoffMs;
		case 'proof-pending':
			return config.proofPendingBackoffMs;
	}
}

function heartbeat(
	now: number,
	cycle: number,
	lastOutcome: ContinuousFullHistoryBackfillOutcome | null
): ContinuousFullHistoryBackfillLoopEvent {
	return {
		at: new Date(now).toISOString(),
		cycle,
		event: 'heartbeat',
		lastOutcome,
		status: 'running'
	};
}

function outcomeEvent(
	result: ContinuousFullHistoryBackfillCycleResult,
	cycle: number,
	startedAt: number,
	finishedAt: number,
	retryInMs: number
): ContinuousFullHistoryBackfillLoopEvent {
	const common = {
		at: new Date(finishedAt).toISOString(),
		cycle,
		durationMs: elapsedMilliseconds(startedAt, finishedAt),
		event: 'outcome' as const,
		retryInMs,
		runStatus: result.run.status,
		scheduleStatus: result.schedule.status
	};
	if (result.run.status === 'idle') return common;
	if (result.run.status === 'completed') {
		return {
			...common,
			jobId: result.run.jobId,
			processedCheckpoints: result.run.processedCheckpoints
		};
	}
	return {
		...common,
		checkpointLedger: result.run.checkpointLedger,
		jobId: result.run.jobId,
		jobState: result.run.jobState,
		processedCheckpoints: result.run.processedCheckpoints
	};
}

function elapsedMilliseconds(startedAt: number, finishedAt: number): number {
	return Math.max(0, finishedAt - startedAt);
}
