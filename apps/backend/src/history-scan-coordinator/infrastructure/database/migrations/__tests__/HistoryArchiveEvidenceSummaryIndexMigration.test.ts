import { HistoryArchiveEvidenceSummaryIndexMigration1784880000000 } from '../1784880000000-HistoryArchiveEvidenceSummaryIndexMigration.js';

describe('HistoryArchiveEvidenceSummaryIndexMigration1784880000000', () => {
	it('builds the evidence covering index concurrently', async () => {
		const statements: string[] = [];
		const migration =
			new HistoryArchiveEvidenceSummaryIndexMigration1784880000000();
		const queryRunner = {
			query: async (sql: string) => {
				statements.push(sql);
				return [];
			}
		};

		await migration.up(queryRunner as never);

		expect(migration.transaction).toBe(false);
		expect(statements.join('\n')).toContain(
			'create index concurrently if not exists'
		);
		expect(statements.join('\n')).toContain(
			'idx_history_archive_object_evidence_summary'
		);
		expect(statements.join('\n')).toContain('"archiveUrlIdentity"');
		expect(statements.join('\n')).toContain('"createdAt"');
		expect(statements.join('\n')).toContain('"failureChannel"');
	});
});
