import { mock } from 'jest-mock-extended';
import type { QueryRunner } from 'typeorm';
import { archiveEvidenceRootSummarySteadyStateTriggerFunctionSql } from '../../../repositories/database/HistoryArchiveEvidenceRootSummarySteadyStateSql.js';
import { archiveObjectTypeSummarySteadyStateTriggerFunctionSql } from '../../../repositories/database/HistoryArchiveObjectTypeSummarySteadyStateSql.js';
import {
	historyArchiveScanningClaimIndexSql,
	HistoryArchiveSummarySteadyStateMigration1785180000000
} from '../1785180000000-HistoryArchiveSummarySteadyStateMigration.js';

const completeProgress = [
	{ caughtUp: true, complete: true, summaryName: 'archive evidence root' },
	{ caughtUp: true, complete: true, summaryName: 'archive object type' }
];

describe('HistoryArchiveSummarySteadyStateMigration1785180000000', () => {
	it('cuts completed summaries over and builds the adoption index concurrently', async () => {
		const queryRunner = createQueryRunner(completeProgress);
		const migration =
			new HistoryArchiveSummarySteadyStateMigration1785180000000();

		await migration.up(queryRunner);

		expect(migration.transaction).toBe(false);
		expect(normalize(historyArchiveScanningClaimIndexSql)).toContain(
			'create index concurrently if not exists "idx_history_archive_object_scanning_claim"'
		);
		expect(normalize(historyArchiveScanningClaimIndexSql)).toContain(
			'on "history_archive_object_queue" ( "claimedAt" asc nulls first, id ) include ("remoteId") where status = \'scanning\''
		);
		expect(queryRunner.startTransaction).toHaveBeenCalledTimes(1);
		expect(queryRunner.commitTransaction).toHaveBeenCalledTimes(1);
		expect(queryRunner.query).toHaveBeenCalledWith(
			archiveEvidenceRootSummarySteadyStateTriggerFunctionSql
		);
		expect(queryRunner.query).toHaveBeenCalledWith(
			archiveObjectTypeSummarySteadyStateTriggerFunctionSql
		);
	});

	it('refuses to cut over an incomplete summary backfill', async () => {
		const queryRunner = createQueryRunner([
			completeProgress[0],
			{
				caughtUp: false,
				complete: false,
				summaryName: 'archive object type'
			}
		]);

		await expect(
			new HistoryArchiveSummarySteadyStateMigration1785180000000().up(
				queryRunner
			)
		).rejects.toThrow('archive object type backfill is incomplete');
		expect(queryRunner.startTransaction).not.toHaveBeenCalled();
		expect(queryRunner.query).not.toHaveBeenCalledWith(
			historyArchiveScanningClaimIndexSql
		);
	});

	it('removes progress reads and double writes from steady-state updates', () => {
		for (const sql of [
			archiveEvidenceRootSummarySteadyStateTriggerFunctionSql,
			archiveObjectTypeSummarySteadyStateTriggerFunctionSql
		]) {
			const normalized = normalize(sql);
			expect(normalized).not.toContain('_summary_progress');
			expect(normalized).not.toContain('pg_advisory_xact_lock_shared');
			expect(normalized).toContain(
				"if tg_op = 'UPDATE' and same_key then update"
			);
			expect(normalized).toContain('if not found then raise exception');
		}
	});
});

function createQueryRunner(
	progress: readonly Readonly<Record<string, unknown>>[]
): ReturnType<typeof mock<QueryRunner>> {
	const queryRunner = mock<QueryRunner>();
	queryRunner.query.mockImplementation((sql: string) => {
		if (sql.includes('as "summaryName"')) return Promise.resolve(progress);
		if (sql.includes('from pg_index')) return Promise.resolve([]);
		return Promise.resolve(undefined);
	});
	return queryRunner;
}

function normalize(sql: string): string {
	return sql.replace(/\s+/gu, ' ').trim();
}
