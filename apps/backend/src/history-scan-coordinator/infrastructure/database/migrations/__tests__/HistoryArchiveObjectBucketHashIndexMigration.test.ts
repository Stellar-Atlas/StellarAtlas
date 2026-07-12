import { HistoryArchiveObjectBucketHashIndexMigration1784890000000 } from '../1784890000000-HistoryArchiveObjectBucketHashIndexMigration.js';

describe('HistoryArchiveObjectBucketHashIndexMigration1784890000000', () => {
	it('builds a partial reverse bucket index concurrently', async () => {
		const statements: string[] = [];
		const migration =
			new HistoryArchiveObjectBucketHashIndexMigration1784890000000();
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
		expect(sql).toContain('idx_history_archive_object_bucket_hash');
		expect(sql).toContain('"bucketHash"');
		expect(sql).toContain('"objectType" = \'bucket\'');
	});
});
