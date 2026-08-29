import type { DataSource, EntityManager, QueryRunner } from 'typeorm';
import { HistoryArchiveSequentialProofChainMigration1785540000000 } from '../../../database/migrations/1785540000000-HistoryArchiveSequentialProofChainMigration.js';
import {
	claimHistoryArchiveCheckpointProofRefreshes,
	claimLockedSequentialProofRefreshSql,
	claimProofRefreshSql,
	claimSequentialProofRefreshSql,
	enqueueCurrentTerminalReadyCheckpointProofRefreshesSql,
	enqueueProofRefreshesSql,
	normalizeConsecutiveProofRefreshTransactionSize,
	normalizeTargetedProofRefreshBatchSize
} from '../HistoryArchiveCheckpointProofRefreshQueue.js';
import { historyArchiveCheckpointProofTerminalReadySql } from '../HistoryArchiveCheckpointProofReadinessSql.js';
import { historyArchiveObjectOpenSequentialCohortSql } from '../HistoryArchiveSequentialChainSql.js';

describe('sequential history archive proof chain', () => {
	it('requires the previous proof before terminal proof refresh work can run', () => {
		const candidateReadiness =
			historyArchiveCheckpointProofTerminalReadySql('candidate');
		const queueReadiness =
			historyArchiveCheckpointProofTerminalReadySql('queue');

		expect(candidateReadiness).toContain(
			"predecessor_proof.status = 'verified'"
		);
		expect(candidateReadiness).toContain(
			'predecessor_proof."checkpointLedger" = candidate."checkpointLedger" - 64'
		);
		expect(candidateReadiness).toContain("('ledger'::text)");
		expect(candidateReadiness).toContain("('transactions'::text)");
		expect(candidateReadiness).toContain("('results'::text)");
		expect(enqueueProofRefreshesSql).toContain(candidateReadiness);
		expect(enqueueProofRefreshesSql).toMatch(
			/candidate\."checkpointLedger"\s*=\s*chain_cursor\."nextHistoricalCheckpointLedger" - 64/
		);
		expect(enqueueCurrentTerminalReadyCheckpointProofRefreshesSql).toContain(
			candidateReadiness
		);
		expect(enqueueCurrentTerminalReadyCheckpointProofRefreshesSql).toMatch(
			/cursor\."nextHistoricalCheckpointLedger"\s*-\s*64/
		);
		expect(enqueueProofRefreshesSql).toMatch(
			/where history_archive_checkpoint_proof_refresh_queue\."leaseUntil" is null\s+or history_archive_checkpoint_proof_refresh_queue\."leaseUntil" <=\s+now\(\)/
		);
		expect(claimProofRefreshSql).toContain(queueReadiness);
		expect(claimSequentialProofRefreshSql).toContain(
			'queue."checkpointLedger" =\n' +
				'\t\t\t\tchain_cursor."nextHistoricalCheckpointLedger" - 64'
		);
	});

	it('bounds consecutive proof work while keeping the same root and cursor gate', () => {
		expect(normalizeConsecutiveProofRefreshTransactionSize(Number.NaN)).toBe(
			16
		);
		expect(normalizeConsecutiveProofRefreshTransactionSize(0)).toBe(16);
		expect(normalizeConsecutiveProofRefreshTransactionSize(32)).toBe(32);
		expect(normalizeConsecutiveProofRefreshTransactionSize(1_000)).toBe(64);
		expect(claimLockedSequentialProofRefreshSql).toContain(
			'queue."archiveUrlIdentity" = any($1::text[])'
		);
		expect(claimLockedSequentialProofRefreshSql).toContain(
			'chain_cursor."nextHistoricalCheckpointLedger" - 64'
		);
		expect(claimLockedSequentialProofRefreshSql).toContain(
			'for update of queue skip locked'
		);
	});

	it('claims a proof batch in one transaction', async () => {
		const targets = [
			{
				archiveUrlIdentity: 'https://one.example',
				checkpointLedger: 63,
				evidenceUpdatedAt: '2026-08-22T00:00:00.000Z',
				generation: '2',
				leaseToken: '10000000-0000-0000-0000-000000000001'
			},
			{
				archiveUrlIdentity: 'https://two.example',
				checkpointLedger: 127,
				evidenceUpdatedAt: '2026-08-22T00:00:01.000Z',
				generation: '3',
				leaseToken: '10000000-0000-0000-0000-000000000002'
			}
		];
		const query = jest
			.fn()
			.mockResolvedValueOnce(undefined)
			.mockResolvedValueOnce(undefined)
			.mockResolvedValueOnce(targets);
		const manager = { query } as unknown as EntityManager;
		const transaction = jest.fn(
			async (callback: (manager: EntityManager) => Promise<unknown>) =>
				await callback(manager)
		);
		const dataSource = { transaction } as unknown as DataSource;

		const claimed = await claimHistoryArchiveCheckpointProofRefreshes(
			dataSource,
			192,
			1
		);

		expect(transaction).toHaveBeenCalledTimes(1);
		expect(query).toHaveBeenCalledTimes(3);
		expect(query).toHaveBeenNthCalledWith(3, claimSequentialProofRefreshSql, [
			normalizeTargetedProofRefreshBatchSize(192)
		]);
		expect(claimed.map((target) => target.generation)).toEqual([2, 3]);
	});

	it('admits only the bounded ordered checkpoint cohort', () => {
		const gate = historyArchiveObjectOpenSequentialCohortSql('candidate');

		expect(gate).toContain('candidate."checkpointLedger" between');
		expect(gate).toContain(
			'chain_cursor."nextHistoricalCheckpointLedger" - 64'
		);
		expect(gate).toContain('64 + 4032');
		expect(gate).toContain('candidate."objectType" = \'bucket\'');
		expect(gate).toContain('dependency."checkpointLedger" between');
	});

	it('resets cursors to genesis without deleting sparse evidence', async () => {
		const query = jest.fn().mockResolvedValue(undefined);
		const runner = { query } as unknown as QueryRunner;
		const migration =
			new HistoryArchiveSequentialProofChainMigration1785540000000();

		await migration.up(runner);

		expect(query).toHaveBeenCalledTimes(2);
		expect(query.mock.calls[0]?.[0]).toContain(
			'"nextHistoricalCheckpointLedger" = 63'
		);
		expect(query.mock.calls[1]?.[0]).toContain(
			'set "descendantsPlannedAt" = null'
		);
		expect(query.mock.calls.flat().join('\n')).not.toMatch(/delete|truncate/i);
		await expect(migration.down()).rejects.toThrow('forward-only');
	});
});
