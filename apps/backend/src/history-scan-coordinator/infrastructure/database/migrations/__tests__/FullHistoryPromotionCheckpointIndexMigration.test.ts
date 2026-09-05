import { fullHistoryPromotionCheckpointIndexSql } from '../1788592000000-FullHistoryPromotionCheckpointIndexMigration.js';

describe('FullHistoryPromotionCheckpointIndexMigration', () => {
	it('indexes the exact checkpoint-first promotion lookup without indexing pending proofs', () => {
		expect(fullHistoryPromotionCheckpointIndexSql).toContain(
			'"checkpointLedger"'
		);
		expect(fullHistoryPromotionCheckpointIndexSql).toContain(
			'"evaluatedAt" desc'
		);
		expect(fullHistoryPromotionCheckpointIndexSql).toContain(
			"where status = 'verified'"
		);
		expect(fullHistoryPromotionCheckpointIndexSql).toContain(
			'and "requiredObjectsComplete"'
		);
		expect(fullHistoryPromotionCheckpointIndexSql).toContain(
			'and "proofFactsComplete"'
		);
		expect(fullHistoryPromotionCheckpointIndexSql).not.toContain(
			'"archiveUrlIdentity", "checkpointLedger"'
		);
	});
});
