import type { PromoteNextFullHistoryCheckpointResult } from '../../../use-cases/promote-next-full-history-checkpoint/PromoteNextFullHistoryCheckpoint.js';
import {
	FullHistoryCanonicalError,
	type FullHistoryCanonicalErrorReason
} from '../../../domain/full-history/FullHistoryCanonicalError.js';
import {
	FullHistoryPromotionError,
	FullHistoryLedgerObservationsMissingError,
	type FullHistoryLedgerObservationCount,
	type FullHistoryPromotionErrorReason
} from '../../../domain/full-history-promotion/FullHistoryPromotionError.js';

export interface FullHistoryPromotionLoopConfig {
	readonly errorBackoffMs: number;
	readonly maximumCheckpointsPerCycle: number;
	readonly networkPassphrase: string;
	readonly pollIntervalMs: number;
}

export interface FullHistoryPromotionLoopDependencies {
	readonly emit: (event: FullHistoryPromotionLoopEvent) => void;
	readonly heartbeat?: () => Promise<void>;
	readonly promoteNext: () => Promise<PromoteNextFullHistoryCheckpointResult>;
	readonly shouldStop: () => boolean;
	readonly wait: (milliseconds: number) => Promise<void>;
}

// Missing legacy projections cannot be repaired by repeating promotion. Keep
// the failure visible while avoiding frequent candidate scans; liveness is separate.
const projectionRetryMinimumMs = 5 * 60_000;
const dependencyHeartbeatIntervalMs = 30_000;

export type FullHistoryPromotionLoopErrorCode =
	| `canonical-${FullHistoryCanonicalErrorReason}`
	| `promotion-${FullHistoryPromotionErrorReason}`
	| 'database-lock-contention'
	| 'unexpected-error';

export interface FullHistoryPromotionLoopEvent {
	readonly archiveUrlIdentity?: string;
	readonly batchId?: string;
	readonly checkpointLedger?: number | null;
	readonly errorCode?: FullHistoryPromotionLoopErrorCode;
	readonly missingLedgerObservations?: FullHistoryLedgerObservationCount;
	readonly nextLedger?: string | null;
	readonly retryInMs?: number;
	readonly status:
		| 'bootstrap-required'
		| 'cycle-failed'
		| 'proof-pending'
		| 'promoted'
		| 'replayed';
}

export async function runFullHistoryPromotionLoop(
	config: FullHistoryPromotionLoopConfig,
	dependencies: FullHistoryPromotionLoopDependencies
): Promise<void> {
	while (!dependencies.shouldStop()) {
		let cycleFailed = false;
		let projectionBlocked = false;
		let retryInMs = config.errorBackoffMs;
		let shouldWait = false;
		for (
			let promoted = 0;
			promoted < config.maximumCheckpointsPerCycle &&
			!dependencies.shouldStop();
			promoted += 1
		) {
			let result: PromoteNextFullHistoryCheckpointResult;
			try {
				result = await dependencies.promoteNext();
			} catch (error) {
				if (dependencies.shouldStop()) return;
				cycleFailed = true;
				projectionBlocked =
					error instanceof FullHistoryLedgerObservationsMissingError;
				if (projectionBlocked) {
					retryInMs = Math.max(retryInMs, projectionRetryMinimumMs);
				}
				dependencies.emit({
					errorCode: fullHistoryPromotionLoopErrorCode(error),
					...(error instanceof FullHistoryLedgerObservationsMissingError
						? { missingLedgerObservations: error.diagnostic }
						: {}),
					retryInMs,
					status: 'cycle-failed'
				});
				break;
			}
			dependencies.emit(toEvent(result));
			if (
				result.status === 'bootstrap-required' ||
				result.status === 'proof-pending'
			) {
				shouldWait = true;
				break;
			}
		}
		if (
			!dependencies.shouldStop() &&
			(cycleFailed || shouldWait || config.pollIntervalMs > 0)
		) {
			if (projectionBlocked) {
				await waitForProjectionRetry(retryInMs, dependencies);
			} else {
				await dependencies.wait(
					cycleFailed ? retryInMs : config.pollIntervalMs
				);
			}
		}
	}
}

async function waitForProjectionRetry(
	milliseconds: number,
	dependencies: FullHistoryPromotionLoopDependencies
): Promise<void> {
	let remaining = milliseconds;
	while (remaining > 0 && !dependencies.shouldStop()) {
		const interval = Math.min(remaining, dependencyHeartbeatIntervalMs);
		await dependencies.wait(interval);
		remaining -= interval;
		if (!dependencies.shouldStop()) await dependencies.heartbeat?.();
	}
}

export function fullHistoryPromotionLoopErrorCode(
	error: unknown
): FullHistoryPromotionLoopErrorCode {
	if (error instanceof FullHistoryPromotionError) {
		return `promotion-${error.reason}`;
	}
	if (error instanceof FullHistoryCanonicalError) {
		return `canonical-${error.reason}`;
	}
	if (postgresErrorCode(error) === '55P03') {
		return 'database-lock-contention';
	}
	return 'unexpected-error';
}

function postgresErrorCode(error: unknown): string | null {
	if (!isRecord(error)) return null;
	if (typeof error.code === 'string') return error.code;
	return isRecord(error.driverError) &&
		typeof error.driverError.code === 'string'
		? error.driverError.code
		: null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toEvent(
	result: PromoteNextFullHistoryCheckpointResult
): FullHistoryPromotionLoopEvent {
	if (result.status === 'promoted' || result.status === 'replayed') {
		return {
			archiveUrlIdentity: result.target.archiveUrlIdentity,
			batchId: result.receipt.batchId,
			checkpointLedger: result.target.checkpointLedger,
			nextLedger: result.receipt.nextLedger,
			status: result.status
		};
	}
	if ('checkpointLedger' in result) {
		return {
			checkpointLedger: result.checkpointLedger,
			nextLedger: result.nextLedger,
			status: result.status
		};
	}
	throw new TypeError('Unsupported full-history promotion loop result');
}
