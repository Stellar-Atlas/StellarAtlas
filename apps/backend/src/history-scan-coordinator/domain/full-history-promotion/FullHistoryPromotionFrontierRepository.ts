import type { FullHistoryUint64String } from '../full-history/FullHistoryCanonicalTypes.js';
import type { FullHistoryPromotionTarget } from './FullHistoryCheckpointCandidate.js';

export interface FullHistoryPromotionFrontier {
	readonly checkpointLedger: number | null;
	readonly nextLedger: FullHistoryUint64String | null;
	readonly targets: readonly FullHistoryPromotionTarget[];
}

export interface FullHistoryPromotionFrontierRepository {
	find(
		networkPassphrase: string,
		maximumTargets: number
	): Promise<FullHistoryPromotionFrontier>;
}
