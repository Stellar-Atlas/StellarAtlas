import { mock } from 'jest-mock-extended';
import type { QueryRunner } from 'typeorm';
import {
	fullHistoryTrustlineObservationIndexSql,
	FullHistoryTrustlineObservationIndexMigration1785170000000
} from '../1785170000000-FullHistoryTrustlineObservationIndexMigration.js';

describe('FullHistoryTrustlineObservationIndexMigration1785170000000', () => {
	it('builds the exact account and descending trustline-position index concurrently', async () => {
		const queryRunner = mock<QueryRunner>();
		queryRunner.query.mockResolvedValue([]);
		const migration =
			new FullHistoryTrustlineObservationIndexMigration1785170000000();

		await migration.up(queryRunner);

		expect(migration.transaction).toBe(false);
		expect(normalize(fullHistoryTrustlineObservationIndexSql)).toContain(
			'create index concurrently if not exists "idx_full_history_lcm_trustline_observation"'
		);
		expect(normalize(fullHistoryTrustlineObservationIndexSql)).toContain(
			'on "full_history_lcm_trustline_state_change" ( "account_id", "ledger_sequence" desc, "transaction_index" desc, "change_index" desc, "batch_id" )'
		);
		expect(queryRunner.query.mock.calls[1]).toEqual([
			fullHistoryTrustlineObservationIndexSql
		]);
	});

	it('drops an invalid interrupted index before retrying the concurrent build', async () => {
		const queryRunner = mock<QueryRunner>();
		queryRunner.query
			.mockResolvedValueOnce([{ indisready: true, indisvalid: false }])
			.mockResolvedValueOnce(undefined)
			.mockResolvedValueOnce(undefined);

		await new FullHistoryTrustlineObservationIndexMigration1785170000000().up(
			queryRunner
		);

		expect(queryRunner.query.mock.calls[1]).toEqual([
			'drop index concurrently if exists "idx_full_history_lcm_trustline_observation"'
		]);
		expect(queryRunner.query.mock.calls[2]).toEqual([
			fullHistoryTrustlineObservationIndexSql
		]);
	});
});

function normalize(sql: string): string {
	return sql.replace(/\s+/gu, ' ').trim();
}
