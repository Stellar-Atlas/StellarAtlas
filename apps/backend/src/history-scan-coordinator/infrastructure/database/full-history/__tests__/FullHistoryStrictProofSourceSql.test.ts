import { strictHistoricalBackfillProofTargetsSql } from '../../full-history-backfill/FullHistoryHistoricalBackfillSql.js';
import { promotionTargetSql } from '../../full-history-promotion/TypeOrmFullHistoryPromotionFrontierRepository.js';
import { fullHistoryStrictProofSourceDigestsSql } from '../FullHistoryStrictProofSourceSql.js';

describe('strict full-history source digest SQL', () => {
	it('gates forward and historical targets on exact source digest evidence', () => {
		for (const sql of [
			promotionTargetSql,
			strictHistoricalBackfillProofTargetsSql
		]) {
			expect(sql).toContain(fullHistoryStrictProofSourceDigestsSql);
		}
		expect(fullHistoryStrictProofSourceDigestsSql).toContain(
			'proof."checkpointStateObjectRemoteId"'
		);
		expect(fullHistoryStrictProofSourceDigestsSql).toContain('canonical-json');
		expect(fullHistoryStrictProofSourceDigestsSql).toContain(
			'uncompressed-xdr'
		);
		expect(fullHistoryStrictProofSourceDigestsSql).toContain(
			"!~ '^[0-9a-f]{64}$'"
		);
	});
});
