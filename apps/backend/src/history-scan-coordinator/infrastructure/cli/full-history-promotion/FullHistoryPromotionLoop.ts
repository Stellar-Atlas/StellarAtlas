import type { PromoteNextFullHistoryCheckpointResult } from '../../../use-cases/promote-next-full-history-checkpoint/PromoteNextFullHistoryCheckpoint.js';

export interface FullHistoryPromotionLoopConfig {
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

export interface FullHistoryPromotionLoopEvent {
	readonly archiveUrlIdentity?: string;
	readonly batchId?: string;
	readonly checkpointLedger?: number | null;
	readonly nextLedger?: string | null;
	readonly status:
		'bootstrap-required' | 'proof-pending' | 'promoted' | 'replayed';
}

export async function runFullHistoryPromotionLoop(
	config: FullHistoryPromotionLoopConfig,
	dependencies: FullHistoryPromotionLoopDependencies
): Promise<void> {
	while (!dependencies.shouldStop()) {
		let shouldWait = false;
		for (
			let promoted = 0;
			promoted < config.maximumCheckpointsPerCycle &&
			!dependencies.shouldStop();
			promoted += 1
		) {
			const result = await dependencies.promoteNext();
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
			(shouldWait || config.pollIntervalMs > 0)
		) {
			await dependencies.wait(config.pollIntervalMs);
		}
	}
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
