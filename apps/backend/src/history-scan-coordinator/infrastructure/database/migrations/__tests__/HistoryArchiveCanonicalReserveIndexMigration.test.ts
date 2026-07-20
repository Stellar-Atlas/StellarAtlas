import type { QueryRunner } from 'typeorm';
import { HistoryArchiveCanonicalReserveIndexMigration1785230000000 } from '../1785230000000-HistoryArchiveCanonicalReserveIndexMigration.js';

describe('HistoryArchiveCanonicalReserveIndexMigration1785230000000', () => {
	it('builds a concurrent partial index for the canonical reservation count', async () => {
		const queries: string[] = [];
		const queryRunner = {
			query: jest.fn(async (sql: string) => {
				queries.push(sql);
				return sql.includes('from pg_class')
					? [{ exists: false, valid: false }]
					: [];
			})
		} as unknown as QueryRunner;
		const migration =
			new HistoryArchiveCanonicalReserveIndexMigration1785230000000();

		await migration.up(queryRunner);

		expect(migration.transaction).toBe(false);
		const sql = queries.join('\n');
		expect(sql).toContain('set statement_timeout = 0');
		expect(sql).toContain('create index concurrently');
		expect(sql).toContain('"idx_history_archive_object_canonical_reserve"');
		expect(sql).toContain('"executionReason" = \'canonical-frontier-reserve\'');
		expect(sql).toContain("status in ('pending', 'scanning')");
		expect(sql).toContain('indisvalid and indisready');
		expect(queries.at(-2)).toContain('set statement_timeout = default');
		expect(queries.at(-1)).toContain('set lock_timeout = default');
	});

	it('removes an interrupted index before rebuilding it', async () => {
		const queries: string[] = [];
		const queryRunner = {
			query: jest.fn(async (sql: string) => {
				queries.push(sql);
				return sql.includes('from pg_class')
					? [{ exists: true, valid: false }]
					: [];
			})
		} as unknown as QueryRunner;

		await new HistoryArchiveCanonicalReserveIndexMigration1785230000000().up(
			queryRunner
		);

		expect(queries.join('\n')).toContain(
			'drop index concurrently if exists "idx_history_archive_object_canonical_reserve"'
		);
	});
});
