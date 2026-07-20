import type { QueryRunner } from 'typeorm';
import { HistoryArchiveCanonicalReserveIndexMigration1785230000000 } from '../1785230000000-HistoryArchiveCanonicalReserveIndexMigration.js';

describe('HistoryArchiveCanonicalReserveIndexMigration1785230000000', () => {
	it('builds a concurrent partial index for the canonical reservation count', async () => {
		const queries: string[] = [];
		const queryRunner = {
			query: jest.fn(async (sql: string) => {
				queries.push(sql);
				return [];
			})
		} as unknown as QueryRunner;
		const migration =
			new HistoryArchiveCanonicalReserveIndexMigration1785230000000();

		await migration.up(queryRunner);

		expect(migration.transaction).toBe(false);
		expect(queries).toHaveLength(1);
		expect(queries[0]).toContain('create index concurrently');
		expect(queries[0]).toContain(
			'"idx_history_archive_object_canonical_reserve"'
		);
		expect(queries[0]).toContain(
			'"executionReason" = \'canonical-frontier-reserve\''
		);
		expect(queries[0]).toContain("status in ('pending', 'scanning')");
	});
});
