import type {
	FullHistoryCheckpointCandidate,
	FullHistoryPromotionTarget
} from './FullHistoryCheckpointCandidate.js';

export interface FullHistoryCheckpointCandidateRepository {
	load(
		target: FullHistoryPromotionTarget
	): Promise<FullHistoryCheckpointCandidate>;
}
