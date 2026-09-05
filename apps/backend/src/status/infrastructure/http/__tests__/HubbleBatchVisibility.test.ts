import { completedHubbleBatchPredicate } from '../HubbleBatchVisibility.js';

describe('completedHubbleBatchPredicate', () => {
	it('resolves latest status and digest together before requiring completion', () => {
		const sql = completedHubbleBatchPredicate('stellar_hubble');
		expect(sql).toContain('(_batch_id, _source_sha256) IN');
		expect(sql).toContain('FROM `stellar_hubble`._ingestion_batches');
		expect(sql).toContain('argMax(tuple(status, source_sha256), updated_at)');
		expect(sql).toContain('GROUP BY batch_id');
		expect(sql).toContain(
			"HAVING tupleElement(argMax(tuple(status, source_sha256), updated_at), 1) = 'complete'"
		);
		expect(sql).not.toMatch(/WHERE\s+status/i);
	});
	it('rejects an invalid database identifier', () => {
		expect(() => completedHubbleBatchPredicate('db; SELECT 1')).toThrow(
			'Invalid Hubble identifier'
		);
	});
});
