import type { QueryRunner } from 'typeorm';
import { FullHistoryLedgerCloseMetaStatusRollupMigration1785220000000 } from '../1785220000000-FullHistoryLedgerCloseMetaStatusRollupMigration.js';

describe('FullHistoryLedgerCloseMetaStatusRollupMigration', () => {
	it('backfills and transactionally maintains compact dataset totals', async () => {
		const queries: string[] = [];
		const queryRunner = {
			query: jest.fn(async (sql: string) => {
				queries.push(sql);
			})
		} as unknown as QueryRunner;

		await new FullHistoryLedgerCloseMetaStatusRollupMigration1785220000000().up(
			queryRunner
		);

		const sql = queries.join('\n');
		expect(sql).toContain(
			'create table "full_history_lcm_dataset_status_rollup"'
		);
		expect(sql).toContain(
			'after insert on "full_history_ledger_close_meta_dataset"'
		);
		expect(sql).toContain('on conflict (');
		expect(sql).toContain('sum("record_count")::numeric');
		expect(sql).toContain('sum("output_bytes")::numeric');
		expect(sql).toContain(
			'group by "network_passphrase_hash", "dataset", "schema_version"'
		);
	});
});
