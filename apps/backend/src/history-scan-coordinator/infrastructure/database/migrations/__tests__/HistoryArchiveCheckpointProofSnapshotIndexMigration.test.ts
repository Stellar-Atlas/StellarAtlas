import { mock } from 'jest-mock-extended';
import type { QueryRunner } from 'typeorm';
import {
	historyArchiveCheckpointProofSnapshotIndex,
	HistoryArchiveCheckpointProofSnapshotIndexMigration1785200000000
} from '../1785200000000-HistoryArchiveCheckpointProofSnapshotIndexMigration.js';

describe('HistoryArchiveCheckpointProofSnapshotIndexMigration', () => {
	it('creates and removes the bounded snapshot index outside a transaction', async () => {
		const queryRunner = mock<QueryRunner>();
		const migration =
			new HistoryArchiveCheckpointProofSnapshotIndexMigration1785200000000();

		expect(migration.transaction).toBe(false);
		await migration.up(queryRunner);
		expect(queryRunner.query).toHaveBeenCalledWith(
			expect.stringContaining(historyArchiveCheckpointProofSnapshotIndex)
		);
		expect(queryRunner.query).toHaveBeenCalledWith(
			expect.stringContaining('include (status)')
		);

		queryRunner.query.mockClear();
		await migration.down(queryRunner);
		expect(queryRunner.query).toHaveBeenCalledWith(
			expect.stringContaining('drop index concurrently')
		);
	});
});
