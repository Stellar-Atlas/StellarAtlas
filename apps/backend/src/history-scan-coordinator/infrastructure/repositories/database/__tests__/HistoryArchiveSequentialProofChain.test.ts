import type { QueryRunner } from 'typeorm';
import { HistoryArchiveSequentialProofChainMigration1785540000000 } from '../../../database/migrations/1785540000000-HistoryArchiveSequentialProofChainMigration.js';
import {
	claimProofRefreshSql,
	claimSequentialProofRefreshSql,
	enqueueCurrentTerminalReadyCheckpointProofRefreshesSql,
	enqueueProofRefreshesSql
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

	it('admits only the checkpoint currently opened by the chain cursor', () => {
		const gate = historyArchiveObjectOpenSequentialCohortSql('candidate');

		expect(gate).toContain(
			'candidate."checkpointLedger" =\n                            chain_cursor."nextHistoricalCheckpointLedger" - 64'
		);
		expect(gate).toContain('candidate."objectType" = \'bucket\'');
		expect(gate).toContain(
			'dependency."checkpointLedger" =\n                                    chain_cursor."nextHistoricalCheckpointLedger" - 64'
		);
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
