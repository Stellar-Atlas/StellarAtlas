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
	});
});
