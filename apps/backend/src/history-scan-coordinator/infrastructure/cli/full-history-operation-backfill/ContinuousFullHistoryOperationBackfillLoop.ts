import type { FullHistoryOperationBackfillExecutionResult } from './FullHistoryOperationBackfillComposition.js';
import type { FullHistoryOperationWorkerMetrics } from './WorkerThreadFullHistoryCheckpointDecoder.js';

export interface ContinuousFullHistoryOperationBackfillLoopConfig {
	readonly batchLimit: number;
	readonly cpuWorkerCount: number;
	readonly errorBackoffMs: number;
	readonly heartbeatIntervalMs: number;
	readonly idleBackoffMs: number;
	readonly leadershipBackoffMs: number;
	readonly successDelayMs: number;
}

export type ContinuousFullHistoryOperationBackfillCycleResult =
	| {
			readonly execution: FullHistoryOperationBackfillExecutionResult;
			readonly status: 'executed';
	  }
	| { readonly status: 'leadership-unavailable' };

export interface ContinuousFullHistoryOperationBackfillFailure {
	readonly message: string;
	readonly workerMetrics?: FullHistoryOperationWorkerMetrics;
}

type LoopOutcome =
	| FullHistoryOperationBackfillExecutionResult['status']
	| 'cycle-failed'
	| 'leadership-unavailable';

type LoopPhase = 'backing-off' | 'executing' | 'idle';

interface LoopTotals {
	readonly accountReferenceFacts: number;
	readonly completedBatches: number;
	readonly failedCycles: number;
	readonly operationFacts: number;
}

export type ContinuousFullHistoryOperationBackfillLoopEvent =
	| {
			readonly activeCycles: 0 | 1;
			readonly at: string;
			readonly batchLimit: number;
			readonly cpuWorkers: number;
			readonly cycle: number;
			readonly event: 'heartbeat';
			readonly lastOutcome: LoopOutcome | null;
			readonly phase: LoopPhase;
			readonly status: 'running' | 'stopping';
			readonly totals: LoopTotals;
	  }
	| {
			readonly at: string;
			readonly cycle: number;
			readonly durationMs: number;
			readonly event: 'cycle-outcome';
			readonly retryInMs: number;
			readonly status: 'leadership-unavailable';
	  }
	| {
			readonly accountReferenceFacts: number;
			readonly at: string;
			readonly batchLimit: number;
			readonly completedBatchIds: readonly string[];
			readonly completedBatches: number;
			readonly cpuWorkers: number;
			readonly cycle: number;
			readonly durationMs: number;
			readonly event: 'cycle-outcome';
			readonly operationFacts: number;
			readonly peakActiveBatches: number;
			readonly retryInMs: number;
			readonly selectedBatches: number;
			readonly selectedWindowFull: boolean;
			readonly status: FullHistoryOperationBackfillExecutionResult['status'];
			readonly workerMetrics: FullHistoryOperationWorkerMetrics;
	  }
	| {
			readonly at: string;
			readonly cycle: number;
			readonly durationMs: number;
			readonly event: 'cycle-error';
			readonly message: string;
			readonly retryInMs: number;
			readonly status: 'failed';
			readonly workerMetrics?: FullHistoryOperationWorkerMetrics;
	  };

export interface ContinuousFullHistoryOperationBackfillLoopDependencies {
	readonly describeFailure: (
		error: unknown
	) => ContinuousFullHistoryOperationBackfillFailure;
	readonly emit: (
		event: ContinuousFullHistoryOperationBackfillLoopEvent
	) => void;
	readonly executeCycle: () => Promise<ContinuousFullHistoryOperationBackfillCycleResult>;
	readonly now: () => number;
	readonly scheduleHeartbeat: (
		emit: () => void,
		intervalMs: number
	) => () => void;
	readonly shouldStop: () => boolean;
	readonly wait: (milliseconds: number) => Promise<void>;
}

export async function runContinuousFullHistoryOperationBackfillLoop(
	config: ContinuousFullHistoryOperationBackfillLoopConfig,
	dependencies: ContinuousFullHistoryOperationBackfillLoopDependencies
): Promise<void> {
	let activeCycles: 0 | 1 = 0;
	let cycle = 0;
	let lastOutcome: LoopOutcome | null = null;
	let phase: LoopPhase = 'idle';
	let totals: LoopTotals = emptyTotals();
	const emitHeartbeat = (): void => {
		dependencies.emit({
			activeCycles,
			at: new Date(dependencies.now()).toISOString(),
			batchLimit: config.batchLimit,
			cpuWorkers: config.cpuWorkerCount,
			cycle,
			event: 'heartbeat',
			lastOutcome,
			phase,
			status: dependencies.shouldStop() ? 'stopping' : 'running',
			totals
		});
	};

	emitHeartbeat();
	const cancelHeartbeat = dependencies.scheduleHeartbeat(
		emitHeartbeat,
		config.heartbeatIntervalMs
	);
	try {
		while (!dependencies.shouldStop()) {
			const startedAt = dependencies.now();
			let retryInMs: number;
			activeCycles = 1;
			phase = 'executing';
			try {
				const result = await dependencies.executeCycle();
				cycle += 1;
				if (result.status === 'leadership-unavailable') {
					lastOutcome = result.status;
					retryInMs = config.leadershipBackoffMs;
					dependencies.emit({
						at: new Date(dependencies.now()).toISOString(),
						cycle,
						durationMs: elapsedMilliseconds(startedAt, dependencies.now()),
						event: 'cycle-outcome',
						retryInMs,
						status: result.status
					});
				} else {
					const execution = result.execution;
					lastOutcome = execution.status;
					retryInMs =
						execution.status === 'idle'
							? config.idleBackoffMs
							: config.successDelayMs;
					totals = addExecution(totals, execution);
					dependencies.emit(
						executionEvent(
							execution,
							cycle,
							startedAt,
							dependencies.now(),
							retryInMs
						)
					);
				}
			} catch (error) {
				cycle += 1;
				lastOutcome = 'cycle-failed';
				retryInMs = config.errorBackoffMs;
				totals = { ...totals, failedCycles: totals.failedCycles + 1 };
				const failure = dependencies.describeFailure(error);
				dependencies.emit({
					at: new Date(dependencies.now()).toISOString(),
					cycle,
					durationMs: elapsedMilliseconds(startedAt, dependencies.now()),
					event: 'cycle-error',
					message: failure.message,
					retryInMs,
					status: 'failed',
					...(failure.workerMetrics === undefined
						? {}
						: { workerMetrics: failure.workerMetrics })
				});
			} finally {
				activeCycles = 0;
			}

			phase = 'backing-off';
			if (!dependencies.shouldStop()) await dependencies.wait(retryInMs);
			phase = 'idle';
		}
	} finally {
		activeCycles = 0;
		cancelHeartbeat();
	}
}

function executionEvent(
	execution: FullHistoryOperationBackfillExecutionResult,
	cycle: number,
	startedAt: number,
	finishedAt: number,
	retryInMs: number
): ContinuousFullHistoryOperationBackfillLoopEvent {
	return {
		accountReferenceFacts: execution.accountReferenceFacts,
		at: new Date(finishedAt).toISOString(),
		batchLimit: execution.batchLimit,
		completedBatchIds: execution.receipts.map((receipt) => receipt.batchId),
		completedBatches: execution.completedBatches,
		cpuWorkers: execution.cpuWorkers,
		cycle,
		durationMs: elapsedMilliseconds(startedAt, finishedAt),
		event: 'cycle-outcome',
		operationFacts: execution.operationFacts,
		peakActiveBatches: execution.peakActiveBatches,
		retryInMs,
		selectedBatches: execution.selectedBatches,
		selectedWindowFull: execution.selectedBatches === execution.batchLimit,
		status: execution.status,
		workerMetrics: execution.workerMetrics
	};
}

function addExecution(
	totals: LoopTotals,
	execution: FullHistoryOperationBackfillExecutionResult
): LoopTotals {
	return {
		accountReferenceFacts: boundedAdd(
			totals.accountReferenceFacts,
			execution.accountReferenceFacts
		),
		completedBatches: boundedAdd(
			totals.completedBatches,
			execution.completedBatches
		),
		failedCycles: totals.failedCycles,
		operationFacts: boundedAdd(totals.operationFacts, execution.operationFacts)
	};
}

function boundedAdd(left: number, right: number): number {
	return Math.min(Number.MAX_SAFE_INTEGER, left + right);
}

function emptyTotals(): LoopTotals {
	return {
		accountReferenceFacts: 0,
		completedBatches: 0,
		failedCycles: 0,
		operationFacts: 0
	};
}

function elapsedMilliseconds(startedAt: number, finishedAt: number): number {
	return Math.max(0, finishedAt - startedAt);
}
