import type { FullHistoryWriteReceipt } from '../../domain/full-history/FullHistoryCanonicalRepository.js';
import type { FullHistoryUint64String } from '../../domain/full-history/FullHistoryCanonicalTypes.js';
import type { FullHistoryPromotionTarget } from '../../domain/full-history-promotion/FullHistoryCheckpointCandidate.js';
import type { FullHistoryPromotionFrontierRepository } from '../../domain/full-history-promotion/FullHistoryPromotionFrontierRepository.js';
import { FullHistoryPromotionError } from '../../domain/full-history-promotion/FullHistoryPromotionError.js';
import type { PromoteFullHistoryCheckpoint } from '../promote-full-history-checkpoint/PromoteFullHistoryCheckpoint.js';

export type PromoteNextFullHistoryCheckpointResult =
	| {
			readonly checkpointLedger: null;
			readonly nextLedger: null;
			readonly status: 'bootstrap-required';
	  }
	| {
			readonly checkpointLedger: number;
			readonly nextLedger: FullHistoryUint64String;
			readonly status: 'proof-pending';
	  }
	| {
			readonly receipt: FullHistoryWriteReceipt;
			readonly status: 'promoted' | 'replayed';
			readonly target: FullHistoryPromotionTarget;
	  };

export class PromoteNextFullHistoryCheckpoint {
	constructor(
		private readonly frontierRepository: FullHistoryPromotionFrontierRepository,
		private readonly promoter: PromoteFullHistoryCheckpoint
	) {}

	async execute(
		networkPassphrase: string
	): Promise<PromoteNextFullHistoryCheckpointResult> {
		const frontier = await this.frontierRepository.find(networkPassphrase, 8);
		if (frontier.nextLedger === null || frontier.checkpointLedger === null) {
			return {
				checkpointLedger: null,
				nextLedger: null,
				status: 'bootstrap-required'
			};
		}
		if (frontier.targets.length === 0) {
			return {
				checkpointLedger: frontier.checkpointLedger,
				nextLedger: frontier.nextLedger,
				status: 'proof-pending'
			};
		}

		let lastEvidenceError: FullHistoryPromotionError | null = null;
		for (const target of frontier.targets) {
			try {
				const receipt = await this.promoter.promote(target);
				return {
					receipt,
					status: receipt.replayed ? 'replayed' : 'promoted',
					target
				};
			} catch (error) {
				if (!(error instanceof FullHistoryPromotionError)) throw error;
				lastEvidenceError = error;
			}
		}
		throw (
			lastEvidenceError ??
			new FullHistoryPromotionError(
				'candidate-incomplete',
				'No verified checkpoint candidate could be promoted'
			)
		);
	}
}
