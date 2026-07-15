import { archiveObjectGlobalBucketHashIndexName } from '../../../repositories/database/HistoryArchiveObjectBucketSummaryQuery.js';
import { HistoryArchiveGlobalBucketHashIndexMigration1785090000000 } from '../1785090000000-HistoryArchiveGlobalBucketHashIndexMigration.js';

describe('HistoryArchiveGlobalBucketHashIndexMigration1785090000000', () => {
	it('builds the global hash-ordered partial index concurrently', async () => {
		const statements: string[] = [];
		const migration =
			new HistoryArchiveGlobalBucketHashIndexMigration1785090000000();
		const runner = {
			query: async (sql: string) => {
				statements.push(sql);
				return [];
			}
		};

		await migration.up(runner as never);

		const sql = statements.join('\n');
		expect(migration.transaction).toBe(false);
		expect(sql).toContain('create index concurrently if not exists');
		expect(sql).toContain(archiveObjectGlobalBucketHashIndexName);
		expect(sql).toContain('("bucketHash")');
		expect(sql).toContain('"objectType" = \'bucket\'');
	});
});
