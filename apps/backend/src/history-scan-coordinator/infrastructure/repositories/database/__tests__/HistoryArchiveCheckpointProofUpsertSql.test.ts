import { historyArchiveCheckpointProofUpsertSql } from '../HistoryArchiveCheckpointProofUpsertSql.js';

describe('historyArchiveCheckpointProofUpsertSql', () => {
	it('preserves nonverified no-op rows and reattests verified proof', () => {
		expect(historyArchiveCheckpointProofUpsertSql).toContain(
			') is distinct from row('
		);
		expect(historyArchiveCheckpointProofUpsertSql).toContain(
			'"history_archive_checkpoint_proof".status = \'verified\''
		);
		expect(historyArchiveCheckpointProofUpsertSql).toContain(
			'excluded.status = \'verified\''
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
