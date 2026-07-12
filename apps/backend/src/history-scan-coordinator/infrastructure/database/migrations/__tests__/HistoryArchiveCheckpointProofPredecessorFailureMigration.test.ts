import { HistoryArchiveCheckpointProofPredecessorFailureMigration1784870000000 } from '../1784870000000-HistoryArchiveCheckpointProofPredecessorFailureMigration.js';

describe('HistoryArchiveCheckpointProofPredecessorFailureMigration', () => {
	it('adds predecessor-missing without weakening the existing taxonomy', async () => {
		const queries: string[] = [];
		const migration =
			new HistoryArchiveCheckpointProofPredecessorFailureMigration1784870000000();
		await migration.up({
			query: async (sql: string) => {
				queries.push(sql);
			}
		} as never);

		const sql = queries.join('\n');
		expect(sql).toContain("'predecessor-missing'");
		expect(sql).toContain("'previous-ledger-hash-mismatch'");
		expect(sql).toContain("'bucket-missing'");
		expect(sql).toContain('not valid');
		expect(sql).toContain('validate constraint');
	});
});
