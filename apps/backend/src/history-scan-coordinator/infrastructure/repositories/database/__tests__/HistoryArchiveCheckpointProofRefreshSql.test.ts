import { historyArchiveCheckpointProofQueuedRefreshSql } from '../HistoryArchiveCheckpointProofRefreshSql.js';

describe('historyArchiveCheckpointProofQueuedRefreshSql', () => {
	it('reports an unchanged current proof as settled refresh work', () => {
		expect(historyArchiveCheckpointProofQueuedRefreshSql).toContain(
			'as "matchedCurrentCount"'
		);
		expect(historyArchiveCheckpointProofQueuedRefreshSql).toContain(
			"proof.status = 'not-evaluable'"
		);
		expect(historyArchiveCheckpointProofQueuedRefreshSql).toContain(
			"derived.status = 'pending'"
		);
	});
	it('materializes per-target chain inputs for batch refreshes', () => {
		expect(historyArchiveCheckpointProofQueuedRefreshSql).toContain(
			'checkpoint_state_facts as materialized ('
		);
		expect(historyArchiveCheckpointProofQueuedRefreshSql).toContain(
			'previous_boundary as materialized ('
		);
		expect(historyArchiveCheckpointProofQueuedRefreshSql).toContain(
			'hash_by_sequence as not materialized ('
		);
		expect(historyArchiveCheckpointProofQueuedRefreshSql).toContain(
			') as transaction_hash'
		);
		expect(historyArchiveCheckpointProofQueuedRefreshSql).toContain(
			') as result_hash'
		);
		expect(historyArchiveCheckpointProofQueuedRefreshSql).not.toContain(
			'left join hash_by_sequence transactions'
		);
		expect(historyArchiveCheckpointProofQueuedRefreshSql).toContain(
			'chain_rollup as materialized ('
		);
		expect(historyArchiveCheckpointProofQueuedRefreshSql).toContain(
			'category_rollup as materialized ('
		);
		expect(historyArchiveCheckpointProofQueuedRefreshSql).toContain(
			'proof_rollup as materialized ('
		);
	});
});
