import { mock } from 'jest-mock-extended';
import type { QueryRunner } from 'typeorm';
import {
	FullHistoryBatchReadIndexesMigration1785030000000,
	fullHistoryOperationBatchOrderIndexSql,
	fullHistoryTransactionResultBatchOrderIndexSql
} from '../1785030000000-FullHistoryBatchReadIndexesMigration.js';

describe('FullHistoryBatchReadIndexesMigration', () => {
	it('builds both batch-order indexes concurrently without changing timeouts', async () => {
		const queryRunner = mock<QueryRunner>();
		queryRunner.query.mockResolvedValue([]);
		const migration = new FullHistoryBatchReadIndexesMigration1785030000000();

		await migration.up(queryRunner);

		expect(migration.transaction).toBe(false);
		expect(normalize(fullHistoryTransactionResultBatchOrderIndexSql)).toContain(
			'on "full_history_transaction_result" ( "batch_id", "ledger_sequence", "transaction_index", "transaction_hash" )'
		);
		expect(normalize(fullHistoryOperationBatchOrderIndexSql)).toContain(
			'on "full_history_operation" ( "batch_id", "ledger_sequence", "transaction_index", "operation_index" )'
		);
		for (const sql of [
			fullHistoryTransactionResultBatchOrderIndexSql,
			fullHistoryOperationBatchOrderIndexSql
		]) {
			expect(normalize(sql)).toContain(
				'create index concurrently if not exists'
			);
			expect(sql).not.toMatch(/(?:lock|statement)_timeout/i);
		}
		expect(queryRunner.query).toHaveBeenCalledTimes(4);
		expect(queryRunner.query.mock.calls[1]).toEqual([
			fullHistoryTransactionResultBatchOrderIndexSql
		]);
		expect(queryRunner.query.mock.calls[3]).toEqual([
			fullHistoryOperationBatchOrderIndexSql
		]);
	});

	it('drops an invalid same-named index before retrying its build', async () => {
		const queryRunner = mock<QueryRunner>();
		queryRunner.query
			.mockResolvedValueOnce([{ indisready: false, indisvalid: false }])
			.mockResolvedValueOnce(undefined)
			.mockResolvedValueOnce(undefined)
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce(undefined);

		await new FullHistoryBatchReadIndexesMigration1785030000000().up(
			queryRunner
		);

		expect(queryRunner.query.mock.calls[1]).toEqual([
			'drop index concurrently if exists "idx_full_history_transaction_result_batch_order"'
		]);
		expect(queryRunner.query.mock.calls[2]).toEqual([
			fullHistoryTransactionResultBatchOrderIndexSql
		]);
	});
});

function normalize(sql: string): string {
	return sql.replace(/\s+/g, ' ').trim();
}
