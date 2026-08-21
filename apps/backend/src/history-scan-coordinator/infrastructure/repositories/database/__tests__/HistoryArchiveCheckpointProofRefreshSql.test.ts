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
});
