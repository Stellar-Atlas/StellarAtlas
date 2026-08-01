import { historyArchiveCheckpointProofUpsertSql } from '../HistoryArchiveCheckpointProofUpsertSql.js';

describe('historyArchiveCheckpointProofUpsertSql', () => {
	it('preserves the proof timestamp when reevaluation produces identical evidence', () => {
		expect(historyArchiveCheckpointProofUpsertSql).toContain(
			') is distinct from row('
		);
		expect(historyArchiveCheckpointProofUpsertSql).not.toContain(
			'excluded."evaluatedAt" >='
		);
		expect(historyArchiveCheckpointProofUpsertSql).toContain(
			'excluded."checkpointStateObjectRemoteId"'
		);
		expect(historyArchiveCheckpointProofUpsertSql).toContain(
			'"history_archive_checkpoint_proof".details'
		);
	});
});
