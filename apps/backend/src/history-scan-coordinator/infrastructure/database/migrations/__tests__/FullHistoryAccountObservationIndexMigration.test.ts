import { mock } from 'jest-mock-extended';
import type { QueryRunner } from 'typeorm';
import {
	fullHistoryAccountObservationIndexSql,
	FullHistoryAccountObservationIndexMigration1785160000000
} from '../1785160000000-FullHistoryAccountObservationIndexMigration.js';

describe('FullHistoryAccountObservationIndexMigration1785160000000', () => {
	it('builds the exact account and descending observation-position index concurrently', async () => {
		const queryRunner = mock<QueryRunner>();
		queryRunner.query.mockResolvedValue([]);
		const migration =
			new FullHistoryAccountObservationIndexMigration1785160000000();

		await migration.up(queryRunner);

		expect(migration.transaction).toBe(false);
		expect(normalize(fullHistoryAccountObservationIndexSql)).toContain(
			'create index concurrently if not exists "idx_full_history_lcm_account_observation"'
		);
		expect(normalize(fullHistoryAccountObservationIndexSql)).toContain(
			'on "full_history_lcm_account_state_change" ( "account_id", "ledger_sequence" desc, "transaction_index" desc, "change_index" desc, "batch_id" )'
		);
		expect(queryRunner.query.mock.calls[1]).toEqual([
			fullHistoryAccountObservationIndexSql
		]);
	});

	it('drops an invalid interrupted index before retrying the concurrent build', async () => {
		const queryRunner = mock<QueryRunner>();
		queryRunner.query
			.mockResolvedValueOnce([{ indisready: true, indisvalid: false }])
			.mockResolvedValueOnce(undefined)
			.mockResolvedValueOnce(undefined);

		await new FullHistoryAccountObservationIndexMigration1785160000000().up(
			queryRunner
		);

		expect(queryRunner.query.mock.calls[1]).toEqual([
			'drop index concurrently if exists "idx_full_history_lcm_account_observation"'
		]);
		expect(queryRunner.query.mock.calls[2]).toEqual([
			fullHistoryAccountObservationIndexSql
		]);
	});
});

function normalize(sql: string): string {
	return sql.replace(/\s+/gu, ' ').trim();
}
