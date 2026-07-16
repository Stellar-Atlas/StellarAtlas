import type { PromoteNextFullHistoryCheckpointResult } from '../../../use-cases/promote-next-full-history-checkpoint/PromoteNextFullHistoryCheckpoint.js';
import {
	FullHistoryCanonicalError,
	type FullHistoryCanonicalErrorReason
} from '../../../domain/full-history/FullHistoryCanonicalError.js';
import {
	FullHistoryPromotionError,
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
	readonly promoteNext: () => Promise<PromoteNextFullHistoryCheckpointResult>;
	readonly shouldStop: () => boolean;
	readonly wait: (milliseconds: number) => Promise<void>;
}

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
				dependencies.emit({
					errorCode: fullHistoryPromotionLoopErrorCode(error),
					retryInMs: config.errorBackoffMs,
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
			await dependencies.wait(
				cycleFailed ? config.errorBackoffMs : config.pollIntervalMs
			);
		}
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
