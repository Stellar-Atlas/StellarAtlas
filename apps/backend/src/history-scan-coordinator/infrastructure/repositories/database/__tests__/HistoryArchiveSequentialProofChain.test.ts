import type { DataSource, EntityManager, QueryRunner } from 'typeorm';
import { HistoryArchiveSequentialProofChainMigration1785540000000 } from '../../../database/migrations/1785540000000-HistoryArchiveSequentialProofChainMigration.js';
import {
	calculateHistoryArchiveCheckpointFanoutBatchSize,
	calculateHistoryArchiveSequentialPrefetchDepth,
	resolveHistoryArchiveSequentialPrefetchDepth
} from '../../../../domain/history-archive-object/HistoryArchiveObjectPlanningPolicy.js';
import {
	claimHistoryArchiveCheckpointProofRefreshes,
	claimLockedContiguousProofRefreshSql,
	claimLockedSequentialProofRefreshSql,
	claimProofRefreshSql,
	claimSequentialProofRefreshSql,
	enqueueCurrentTerminalReadyCheckpointProofRefreshesSql,
	proofRefreshBatchHandledEveryValidTarget,
	enqueueProofRefreshesSql,
	normalizeConsecutiveProofRefreshTransactionSize,
	normalizeTargetedProofRefreshBatchSize
} from '../HistoryArchiveCheckpointProofRefreshQueue.js';
import {
	historyArchiveCheckpointProofEvidenceTerminalSql,
	historyArchiveCheckpointProofTerminalReadySql
} from '../HistoryArchiveCheckpointProofReadinessSql.js';
import { frontierTransitionsSql } from '../HistoryArchiveObjectTransitionQuery.js';
import {
	getHistoryArchiveCanonicalFirstRoot,
	historyArchiveCanonicalFirstAdmissionSql,
	historyArchiveCanonicalFirstScopeCteSql
} from '../HistoryArchiveCanonicalFirst.js';
import {
	targetedCheckpointSubstitutionSql,
	targetedCompactCheckpointPlanSql
} from '../HistoryArchiveCompactPlanning.js';
import {
	activateCurrentCheckpointDependenciesSql,
	orderedCheckpointPrefetchSql
} from '../HistoryArchiveCheckpointPrefetch.js';
import { historyArchiveCheckpointProofBatchQueuedRefreshSql } from '../HistoryArchiveCheckpointProofRefreshSql.js';
import { historyArchiveCheckpointProofBatchTargetCtesSql } from '../HistoryArchiveCheckpointProofTargetSql.js';
import { historyArchiveCheckpointProofBatchQueuedUpsertSql } from '../HistoryArchiveCheckpointProofUpsertSql.js';
import { historyArchiveObjectOpenSequentialCohortSql } from '../HistoryArchiveSequentialChainSql.js';

describe('sequential history archive proof chain', () => {
	it('requires the previous proof before terminal proof refresh work can run', () => {
		const candidateReadiness =
			historyArchiveCheckpointProofTerminalReadySql('candidate');
		const queueReadiness =
			historyArchiveCheckpointProofTerminalReadySql('queue');
		const evidenceReadiness =
			historyArchiveCheckpointProofEvidenceTerminalSql('candidate');

		expect(candidateReadiness).toContain(
			"predecessor_proof.status = 'verified'"
		);
		expect(candidateReadiness).toContain(
			'predecessor_proof."checkpointLedger" = candidate."checkpointLedger" - 64'
		);
		expect(candidateReadiness).toContain(
			'predecessor_substitution."checkpointLedger" = candidate."checkpointLedger" - 64'
		);
		expect(candidateReadiness).toContain("('ledger'::text)");
		expect(candidateReadiness).toContain("('transactions'::text)");
		expect(candidateReadiness).toContain("('results'::text)");
		expect(evidenceReadiness).not.toContain('predecessor_proof');
		expect(evidenceReadiness).toContain('candidate."checkpointLedger"');
		expect(enqueueProofRefreshesSql).toContain(candidateReadiness);
		expect(enqueueProofRefreshesSql).toMatch(
			/candidate\."checkpointLedger"\s*=\s*chain_cursor\."nextHistoricalCheckpointLedger" - 64/
		);
		expect(enqueueProofRefreshesSql).toContain(
			'checkpoint."proofReconciledAt"'
		);
		expect(enqueueProofRefreshesSql).toContain(
			') >= candidate.evidence_updated_at'
		);
		expect(enqueueCurrentTerminalReadyCheckpointProofRefreshesSql).toContain(
			'Recovery seeding only repairs a missing proof row'
		);
		expect(enqueueProofRefreshesSql).toContain(
			"when object.status = 'verified' then greatest"
		);
		expect(enqueueProofRefreshesSql).toContain(
			'coalesce(object."verifiedAt", object."updatedAt")'
		);
		expect(enqueueCurrentTerminalReadyCheckpointProofRefreshesSql).toContain(
			candidateReadiness
		);
		expect(enqueueCurrentTerminalReadyCheckpointProofRefreshesSql).toMatch(
			/cursor\."nextHistoricalCheckpointLedger"\s*-\s*64/
		);
		expect(enqueueProofRefreshesSql).toMatch(
			/generation\s*=\s*history_archive_checkpoint_proof_refresh_queue\.generation \+ 1/
		);
		expect(enqueueCurrentTerminalReadyCheckpointProofRefreshesSql).toContain(
			'pg_try_advisory_xact_lock'
		);
		expect(enqueueProofRefreshesSql).toContain(
			'lockable_roots as materialized'
		);
		expect(enqueueProofRefreshesSql).toContain('"leaseToken" = null');
		expect(enqueueProofRefreshesSql).toContain('"leaseUntil" = null');
		expect(enqueueProofRefreshesSql).toContain(
			'where excluded."evidenceUpdatedAt" >'
		);
		expect(enqueueProofRefreshesSql).toContain(
			'history_archive_checkpoint_proof_refresh_queue."evidenceUpdatedAt"'
		);
		expect(claimProofRefreshSql).toContain(queueReadiness);
		expect(claimSequentialProofRefreshSql).toContain(
			'queue."checkpointLedger" =\n' +
				'\t\t\t\tchain_cursor."nextHistoricalCheckpointLedger" - 64'
		);
		expect(claimSequentialProofRefreshSql).toContain(
			historyArchiveCanonicalFirstScopeCteSql('$1::text')
		);
		expect(claimSequentialProofRefreshSql).toContain(
			historyArchiveCanonicalFirstAdmissionSql(
				'queue."archiveUrlIdentity"',
				'$1::text'
			)
		);
	});

	it('normalizes the one canonical-first root used by every admission path', () => {
		expect(
			getHistoryArchiveCanonicalFirstRoot({
				HISTORY_ARCHIVE_CANONICAL_FIRST_ROOT:
					'http://history.stellar.org/prd/core-live/core_live_001///'
			})
		).toBe('http://history.stellar.org/prd/core-live/core_live_001');
		expect(getHistoryArchiveCanonicalFirstRoot({})).toBeNull();
	});

	it('uses indexable direct and substitution predecessor lookups', () => {
		const start = historyArchiveCheckpointProofBatchQueuedRefreshSql.indexOf(
			'previous_boundary as materialized'
		);
		const end = historyArchiveCheckpointProofBatchQueuedRefreshSql.indexOf(
			'ledger_chain as',
			start
		);
		const predecessorSql =
			historyArchiveCheckpointProofBatchQueuedRefreshSql.slice(start, end);
		expect(predecessorSql).toContain('union all');
		expect(predecessorSql).toContain('source_priority');
		expect(predecessorSql).toContain('source_proof."ledgerObjectRemoteId"');
		expect(predecessorSql).not.toContain('or exists');
	});

	it('prefetches upcoming canonical objects while proof claims stay sequential', () => {
		expect(orderedCheckpointPrefetchSql).toContain(
			'on conflict ("archiveUrlIdentity", "objectType", "objectKey") do nothing'
		);
		expect(orderedCheckpointPrefetchSql).not.toContain('do update');
		expect(activateCurrentCheckpointDependenciesSql).toContain(
			`object."objectType" = 'checkpoint-state'`
		);
		expect(activateCurrentCheckpointDependenciesSql).toContain(
			'cross join lateral generate_series('
		);
		expect(activateCurrentCheckpointDependenciesSql).toContain(
			'(($2::integer - 1) * 64)'
		);
		expect(activateCurrentCheckpointDependenciesSql).toContain(
			'object."checkpointLedger" = current."checkpointLedger"'
		);
		expect(activateCurrentCheckpointDependenciesSql).toContain(
			'join "history_archive_checkpoint_bucket_set_member" member'
		);
		expect(activateCurrentCheckpointDependenciesSql).toContain(
			'candidate_ids as materialized'
		);
		expect(activateCurrentCheckpointDependenciesSql).toContain(
			'partition by object."archiveUrlIdentity"'
		);
		expect(activateCurrentCheckpointDependenciesSql).toContain(
			'order by root_rank, "archiveUrlIdentity"'
		);
		expect(activateCurrentCheckpointDependenciesSql).toContain(
			'limit $3::integer'
		);
		expect(activateCurrentCheckpointDependenciesSql).toContain(
			`proof."failureKind" = 'proof-facts-incomplete'`
		);
		expect(activateCurrentCheckpointDependenciesSql).toContain(
			'{ledgerCategory,headerHashesVerified}'
		);
		expect(activateCurrentCheckpointDependenciesSql).toContain(
			'candidate."needsReverification"'
		);
		expect(activateCurrentCheckpointDependenciesSql).not.toContain(
			`object."executionReason" is distinct from 'canonical-frontier-waiting'`
		);
		expect(activateCurrentCheckpointDependenciesSql).not.toContain(
			'proof-completion-waiting'
		);
	});

	it('bounds consecutive proof work while keeping the same root and cursor gate', () => {
		expect(calculateHistoryArchiveSequentialPrefetchDepth(0)).toBe(64);
		expect(calculateHistoryArchiveSequentialPrefetchDepth(60)).toBe(64);
		expect(calculateHistoryArchiveSequentialPrefetchDepth(240)).toBe(240);
		expect(calculateHistoryArchiveSequentialPrefetchDepth(1_000)).toBe(1_000);
		expect(calculateHistoryArchiveCheckpointFanoutBatchSize(0)).toBe(16);
		expect(resolveHistoryArchiveSequentialPrefetchDepth(undefined, 120)).toBe(
			120
		);
		expect(resolveHistoryArchiveSequentialPrefetchDepth('2', 120)).toBe(2);
		expect(resolveHistoryArchiveSequentialPrefetchDepth('0', 120)).toBe(120);
		expect(resolveHistoryArchiveSequentialPrefetchDepth('invalid', 120)).toBe(
			120
		);
		expect(calculateHistoryArchiveCheckpointFanoutBatchSize(60)).toBe(16);
		expect(calculateHistoryArchiveCheckpointFanoutBatchSize(240)).toBe(60);
		expect(calculateHistoryArchiveCheckpointFanoutBatchSize(1_000)).toBe(64);
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
		expect(claimLockedContiguousProofRefreshSql).toContain('generate_series(');
		expect(claimLockedContiguousProofRefreshSql).toContain(
			'bool_and(terminal) over'
		);
		expect(claimLockedContiguousProofRefreshSql).toContain(
			historyArchiveCheckpointProofEvidenceTerminalSql('candidate')
		);
		expect(frontierTransitionsSql).toContain(
			'chain_cursor."nextHistoricalCheckpointLedger" - 64'
		);
		expect(frontierTransitionsSql).toContain("when 'checkpoint-state' then 0");
		expect(targetedCompactCheckpointPlanSql).toContain('row_number() over');
		expect(targetedCompactCheckpointPlanSql).toContain(
			'completed."firstCheckpointLedger" + 64'
		);
		expect(targetedCompactCheckpointPlanSql).toContain(
			'completed."checkpointLedger" + 64 as checkpoint_ledger'
		);
		expect(targetedCompactCheckpointPlanSql).toContain(
			'order by source."archiveUrlIdentity", source.checkpoint_ledger'
		);
		expect(targetedCheckpointSubstitutionSql).toContain(
			'source."archiveUrlIdentity" = $2::text'
		);
		expect(targetedCheckpointSubstitutionSql).toContain(
			'failed."failureKind" = \'object-failed\''
		);
		expect(targetedCheckpointSubstitutionSql).toContain(
			'failed_object."httpStatus" in (403, 404, 410)'
		);
		expect(targetedCheckpointSubstitutionSql).toContain(
			'failed_bucket."httpStatus" in (403, 404, 410)'
		);
		expect(targetedCheckpointSubstitutionSql).toContain(
			'insert into "history_archive_checkpoint_substitution"'
		);
		expect(targetedCheckpointSubstitutionSql).not.toContain('order by case');
		expect(historyArchiveCheckpointProofBatchTargetCtesSql).toContain(
			'queue."leaseToken" = target."leaseToken"'
		);
		expect(historyArchiveCheckpointProofBatchTargetCtesSql).toContain(
			'queue.generation = target.generation'
		);
		expect(historyArchiveCheckpointProofBatchTargetCtesSql).toContain(
			'target."evidenceUpdatedAt"'
		);
		expect(historyArchiveCheckpointProofBatchQueuedUpsertSql).not.toContain(
			'from locked_targets target'
		);
	});

	it('drops stale claims without rolling back valid proof targets', () => {
		expect(proofRefreshBatchHandledEveryValidTarget(8, 7, 7)).toBe(true);
		expect(proofRefreshBatchHandledEveryValidTarget(8, 8, 8)).toBe(true);
		expect(proofRefreshBatchHandledEveryValidTarget(8, 7, 6)).toBe(false);
		expect(proofRefreshBatchHandledEveryValidTarget(8, 9, 9)).toBe(false);
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
		const previousCanonicalRoot =
			process.env.HISTORY_ARCHIVE_CANONICAL_FIRST_ROOT;
		process.env.HISTORY_ARCHIVE_CANONICAL_FIRST_ROOT =
			'https://canonical.example/';

		const claimed = await (async () => {
			try {
				return await claimHistoryArchiveCheckpointProofRefreshes(
					dataSource,
					192,
					1
				);
			} finally {
				if (previousCanonicalRoot === undefined)
					delete process.env.HISTORY_ARCHIVE_CANONICAL_FIRST_ROOT;
				else
					process.env.HISTORY_ARCHIVE_CANONICAL_FIRST_ROOT =
						previousCanonicalRoot;
			}
		})();

		expect(transaction).toHaveBeenCalledTimes(1);
		expect(query).toHaveBeenCalledTimes(3);
		expect(query).toHaveBeenNthCalledWith(3, claimSequentialProofRefreshSql, [
			'https://canonical.example',
			normalizeTargetedProofRefreshBatchSize(192)
		]);
		expect(claimed.map((target) => target.generation)).toEqual([2, 3]);
	});
	it('falls back to all current roots when canonical proof work is empty', async () => {
		const target = {
			archiveUrlIdentity: 'https://other.example',
			checkpointLedger: 127,
			evidenceUpdatedAt: '2026-08-22T00:00:01.000Z',
			generation: '3',
			leaseToken: '10000000-0000-0000-0000-000000000002'
		};
		const query = jest
			.fn()
			.mockResolvedValueOnce(undefined)
			.mockResolvedValueOnce(undefined)
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([target]);
		const manager = { query } as unknown as EntityManager;
		const transaction = jest.fn(
			async (callback: (manager: EntityManager) => Promise<unknown>) =>
				await callback(manager)
		);
		const dataSource = { transaction } as unknown as DataSource;
		const previousCanonicalRoot =
			process.env.HISTORY_ARCHIVE_CANONICAL_FIRST_ROOT;
		process.env.HISTORY_ARCHIVE_CANONICAL_FIRST_ROOT =
			'https://canonical.example/';

		const claimed = await (async () => {
			try {
				return await claimHistoryArchiveCheckpointProofRefreshes(
					dataSource,
					192,
					1
				);
			} finally {
				if (previousCanonicalRoot === undefined)
					delete process.env.HISTORY_ARCHIVE_CANONICAL_FIRST_ROOT;
				else
					process.env.HISTORY_ARCHIVE_CANONICAL_FIRST_ROOT =
						previousCanonicalRoot;
			}
		})();

		expect(transaction).toHaveBeenCalledTimes(1);
		expect(query).toHaveBeenCalledTimes(4);
		expect(query).toHaveBeenNthCalledWith(3, claimSequentialProofRefreshSql, [
			'https://canonical.example',
			normalizeTargetedProofRefreshBatchSize(192)
		]);
		expect(query).toHaveBeenNthCalledWith(4, claimSequentialProofRefreshSql, [
			null,
			normalizeTargetedProofRefreshBatchSize(192)
		]);
		expect(claimed).toEqual([{ ...target, generation: 3 }]);
	});

	it('admits only the bounded ordered checkpoint cohort', () => {
		const gate = historyArchiveObjectOpenSequentialCohortSql('candidate');

		expect(gate).toContain('candidate."checkpointLedger" between');
		expect(gate).toContain(
			'chain_cursor."nextHistoricalCheckpointLedger" - 64'
		);
		expect(gate).toContain('64 + 4032');
		expect(gate).toContain('candidate."objectType" = \'bucket\'');
		expect(gate).toContain('observation."checkpointLedger" between');
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
