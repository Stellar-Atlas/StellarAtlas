import { historyArchiveConsumerCount } from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveObjectPlanningPolicy.js';
import type { DataSource, EntityManager } from 'typeorm';
import type {
	HistoryArchiveCheckpointProofRefreshDrainResult,
	HistoryArchiveCheckpointProofRefreshPriority
} from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveObjectRepository.js';
import { canonicalRuntimeTargetCtes } from './HistoryArchiveCanonicalRuntimeTargetSql.js';
import { dueProofRefreshCanonicalRuntimeArchiveRootsCteSql } from './HistoryArchiveCanonicalRuntimePrioritySql.js';
import {
	materializeCompactCheckpointPlans,
	materializeNextCompactCheckpointPlan,
	materializeNextCompactCheckpointPlans
} from './HistoryArchiveCompactPlanning.js';
import { canonicalRuntimeExecutableProofMemberExistsSql } from './HistoryArchiveCanonicalRuntimeProofMembershipSql.js';
import {
	historyArchiveCheckpointProofBatchQueuedRefreshSql,
	historyArchiveCheckpointProofQueuedRefreshSql
} from './HistoryArchiveCheckpointProofRefreshSql.js';
import {
	historyArchiveCheckpointProofPendingSourceBatchEnrichmentSql,
	historyArchiveCheckpointProofPendingSourceEnrichmentSql
} from './HistoryArchiveCheckpointProofPostRefreshSql.js';
import {
	historyArchiveCheckpointProofEvidenceTerminalSql,
	historyArchiveCheckpointProofTerminalReadySql
} from './HistoryArchiveCheckpointProofReadinessSql.js';
import {
	lockHistoryArchiveRootTransition,
	lockHistoryArchiveRootTransitions
} from './HistoryArchiveRootTransitionLock.js';

export interface ClaimedHistoryArchiveCheckpointProofRefresh {
	readonly archiveUrlIdentity: string;
	readonly checkpointLedger: number;
	readonly evidenceUpdatedAt: Date | string;
	readonly generation: number;
	readonly leaseToken: string;
}

interface ProofRefreshWriteResult {
	readonly handledCount?: number | string;
	readonly handledcount?: number | string;
	readonly targetCount?: number | string;
	readonly targetcount?: number | string;
	readonly acknowledgedCount?: number | string;
	readonly acknowledgedcount?: number | string;
	readonly matchedCurrentCount?: number | string;
	readonly matchedcurrentcount?: number | string;
	readonly preservedAttestationCount?: number | string;
	readonly preservedattestationcount?: number | string;
	readonly upsertedCount?: number | string;
	readonly upsertedcount?: number | string;
}

export const defaultTargetedProofRefreshBatchSize = historyArchiveConsumerCount;
export const maximumTargetedProofRefreshBatchSize = historyArchiveConsumerCount;

const defaultConsecutiveProofRefreshTransactionSize = 16;
const maximumConsecutiveProofRefreshTransactionSize = 64;

const maximumSetBasedConsecutiveProofRefreshWaveSize =
	maximumConsecutiveProofRefreshTransactionSize;
export function normalizeConsecutiveProofRefreshTransactionSize(
	value: number
): number {
	if (!Number.isSafeInteger(value) || value < 1) {
		return defaultConsecutiveProofRefreshTransactionSize;
	}
	return Math.min(value, maximumConsecutiveProofRefreshTransactionSize);
}

function consecutiveProofRefreshTransactionSize(): number {
	return normalizeConsecutiveProofRefreshTransactionSize(
		Number.parseInt(
			process.env.HISTORY_ARCHIVE_CONSECUTIVE_PROOF_BATCH_SIZE ?? '',
			10
		)
	);
}

export interface HistoryArchiveCheckpointProofRefreshQueueStatus {
	readonly depth: number;
	readonly leased: number;
	readonly maximumAttempts: number;
	readonly oldestDueAt: Date | null;
	readonly oldestRequestedAt: Date | null;
	readonly retrying: number;
}

interface ProofRefreshQueueStatusRow {
	readonly depth: number | string;
	readonly leased: number | string;
	readonly maximumAttempts?: number | string | null;
	readonly maximumattempts?: number | string | null;
	readonly oldestDueAt?: Date | string | null;
	readonly oldestdueat?: Date | string | null;
	readonly oldestRequestedAt?: Date | string | null;
	readonly oldestrequestedat?: Date | string | null;
	readonly retrying: number | string;
}

export async function enqueueHistoryArchiveCheckpointProofRefreshes(
	manager: EntityManager,
	remoteIds: readonly string[]
): Promise<number> {
	if (remoteIds.length === 0) return 0;
	const [row] = (await manager.query(enqueueProofRefreshesSql, [
		[...remoteIds]
	])) as readonly { readonly count: number | string }[];
	return Number(row?.count ?? 0);
}
export async function enqueueCurrentTerminalReadyCheckpointProofRefreshes(
	manager: EntityManager,
	limit: number
): Promise<number> {
	const [row] = (await manager.query(
		enqueueCurrentTerminalReadyCheckpointProofRefreshesSql,
		[null, Math.max(1, Math.min(Math.floor(limit), 4_096))]
	)) as readonly { readonly count: number | string }[];
	return Number(row?.count ?? 0);
}

export async function enqueueTargetedTerminalReadyCheckpointProofRefreshes(
	manager: EntityManager,
	archiveUrlIdentities: readonly string[]
): Promise<number> {
	const uniqueIdentities = [...new Set(archiveUrlIdentities)].filter(
		(identity) => identity.length > 0
	);
	if (uniqueIdentities.length === 0) return 0;
	const [row] = (await manager.query(
		enqueueCurrentTerminalReadyCheckpointProofRefreshesSql,
		[uniqueIdentities, uniqueIdentities.length]
	)) as readonly { readonly count: number | string }[];
	return Number(row?.count ?? 0);
}

export const enqueueCurrentTerminalReadyCheckpointProofRefreshesSql = `
        with candidates as materialized (
                select cursor."archiveUrlIdentity",
                        cursor."nextHistoricalCheckpointLedger" - 64
                                as "checkpointLedger"
                from "history_archive_checkpoint_scan_cursor" cursor
                where ($1::text[] is null or cursor."archiveUrlIdentity" = any($1::text[]))
                and not exists (
                        select 1
                        from "history_archive_checkpoint_proof" proof
                        where proof."archiveUrlIdentity" =
                                cursor."archiveUrlIdentity"
                        and proof."checkpointLedger" =
                                cursor."nextHistoricalCheckpointLedger" - 64
                        and proof.status = 'verified'
                )
                and not exists (
                        select 1
                        from "history_archive_checkpoint_proof_refresh_queue" queued
                        where queued."archiveUrlIdentity" =
                                cursor."archiveUrlIdentity"
                        and queued."checkpointLedger" =
                                cursor."nextHistoricalCheckpointLedger" - 64
                )
                order by cursor."archiveUrlIdentity"
                limit $2::integer
        ), terminal as materialized (
                select candidate.*
                from candidates candidate
                where ${historyArchiveCheckpointProofTerminalReadySql('candidate')}
        ), enqueued as (
                insert into "history_archive_checkpoint_proof_refresh_queue" (
                        "archiveUrlIdentity",
                        "checkpointLedger",
                        "evidenceUpdatedAt",
                        generation,
                        "requestedAt",
                        "nextAttemptAt",
                        "updatedAt"
                )
                select "archiveUrlIdentity",
                        "checkpointLedger",
                        now(),
                        1,
                        now(),
                        now(),
                        now()
                from terminal
                order by "archiveUrlIdentity", "checkpointLedger"
                on conflict ("archiveUrlIdentity", "checkpointLedger") do nothing
                returning 1
        )
        select count(*)::integer as count
        from enqueued
`;

export async function drainHistoryArchiveCheckpointProofRefreshes(
	dataSource: DataSource,
	limit: number,
	maximumPriority: HistoryArchiveCheckpointProofRefreshPriority
): Promise<HistoryArchiveCheckpointProofRefreshDrainResult> {
	const safeLimit = normalizeTargetedProofRefreshBatchSize(limit);
	const targets = await claimHistoryArchiveCheckpointProofRefreshes(
		dataSource,
		safeLimit,
		maximumPriority
	);
	const outcome = await refreshProofRefreshBatchWithIsolation(
		dataSource,
		targets
	);
	return {
		claimed: targets.length,
		completed: outcome.completed,
		failed: outcome.failed
	};
}

export async function getHistoryArchiveCheckpointProofRefreshQueueStatus(
	dataSource: DataSource
): Promise<HistoryArchiveCheckpointProofRefreshQueueStatus> {
	const [row] = (await dataSource.query(
		proofRefreshQueueStatusSql
	)) as readonly ProofRefreshQueueStatusRow[];
	if (row === undefined) {
		return {
			depth: 0,
			leased: 0,
			maximumAttempts: 0,
			oldestDueAt: null,
			oldestRequestedAt: null,
			retrying: 0
		};
	}
	const oldestDueAt = row.oldestDueAt ?? row.oldestdueat ?? null;
	const oldestRequestedAt =
		row.oldestRequestedAt ?? row.oldestrequestedat ?? null;
	return {
		depth: Number(row.depth),
		leased: Number(row.leased),
		maximumAttempts: Number(row.maximumAttempts ?? row.maximumattempts ?? 0),
		oldestDueAt: oldestDueAt === null ? null : new Date(oldestDueAt),
		oldestRequestedAt:
			oldestRequestedAt === null ? null : new Date(oldestRequestedAt),
		retrying: Number(row.retrying)
	};
}

export function normalizeTargetedProofRefreshBatchSize(value: number): number {
	if (!Number.isSafeInteger(value) || value < 1) {
		return defaultTargetedProofRefreshBatchSize;
	}
	return Math.min(value, maximumTargetedProofRefreshBatchSize);
}

export async function claimHistoryArchiveCheckpointProofRefreshes(
	dataSource: DataSource,
	limit: number,
	maximumPriority: HistoryArchiveCheckpointProofRefreshPriority
): Promise<readonly ClaimedHistoryArchiveCheckpointProofRefresh[]> {
	const safeLimit = normalizeTargetedProofRefreshBatchSize(limit);
	return await dataSource.transaction(async (manager) => {
		await manager.query(`set local lock_timeout = '250ms'`);
		await manager.query(`set local statement_timeout = '2s'`);
		const claimSql =
			maximumPriority === 1
				? claimSequentialProofRefreshSql
				: claimProofRefreshSql;
		const parameters =
			maximumPriority === 1 ? [safeLimit] : [maximumPriority, safeLimit];
		const rows = (await manager.query(claimSql, parameters)) as readonly (Omit<
			ClaimedHistoryArchiveCheckpointProofRefresh,
			'generation'
		> & { readonly generation: number | string })[];
		return rows.map((row) => ({
			...row,
			generation: Number(row.generation)
		}));
	});
}

export async function claimNextHistoryArchiveCheckpointProofRefresh(
	dataSource: DataSource,
	maximumPriority: HistoryArchiveCheckpointProofRefreshPriority
): Promise<ClaimedHistoryArchiveCheckpointProofRefresh | undefined> {
	const [target] = await claimHistoryArchiveCheckpointProofRefreshes(
		dataSource,
		1,
		maximumPriority
	);
	return target;
}

export async function refreshClaimedHistoryArchiveCheckpointProof(
	dataSource: DataSource,
	target: ClaimedHistoryArchiveCheckpointProofRefresh
): Promise<boolean> {
	return await dataSource.transaction(async (manager) => {
		await manager.query(`set local lock_timeout = '2s'`);
		await manager.query(`set local statement_timeout = '30s'`);
		await lockHistoryArchiveRootTransition(manager, target.archiveUrlIdentity);
		const lease = (await manager.query(lockClaimedProofRefreshSql, [
			target.archiveUrlIdentity,
			target.checkpointLedger,
			target.leaseToken,
			target.generation
		])) as readonly { readonly leaseToken: string }[];
		if (lease.length === 0) return false;

		const [write] = (await manager.query(
			historyArchiveCheckpointProofQueuedRefreshSql,
			[
				target.archiveUrlIdentity,
				target.checkpointLedger,
				null,
				false,
				target.leaseToken,
				target.generation,
				target.evidenceUpdatedAt
			]
		)) as readonly ProofRefreshWriteResult[];
		const upserted = Number(write?.upsertedCount ?? write?.upsertedcount ?? 0);
		const acknowledged = Number(
			write?.acknowledgedCount ?? write?.acknowledgedcount ?? 0
		);
		const preserved = Number(
			write?.preservedAttestationCount ?? write?.preservedattestationcount ?? 0
		);
		const matchedCurrent = Number(
			write?.matchedCurrentCount ?? write?.matchedcurrentcount ?? 0
		);
		if (upserted + acknowledged + preserved + matchedCurrent < 1) {
			throw new Error(
				`Checkpoint proof refresh was neither persisted nor acknowledged ` +
					`(upserted=${upserted}, acknowledged=${acknowledged}, ` +
					`preserved=${preserved}, matchedCurrent=${matchedCurrent})`
			);
		}
		await manager.query(
			historyArchiveCheckpointProofPendingSourceEnrichmentSql,
			[target.archiveUrlIdentity, target.checkpointLedger]
		);
		await materializeNextCompactCheckpointPlan(
			manager,
			target.archiveUrlIdentity,
			target.checkpointLedger
		);
		const deleted = (await manager.query(completeProofRefreshSql, [
			target.archiveUrlIdentity,
			target.checkpointLedger,
			target.leaseToken,
			target.generation
		])) as unknown;
		const deletedRows = extractQueryRows<{ readonly checkpointLedger: number }>(
			deleted
		);
		return deletedRows.length > 0;
	});
}

interface ProofRefreshBatchOutcome {
	readonly completed: number;
	readonly failed: number;
}

async function refreshProofRefreshBatchWithIsolation(
	dataSource: DataSource,
	targets: readonly ClaimedHistoryArchiveCheckpointProofRefresh[]
): Promise<ProofRefreshBatchOutcome> {
	if (targets.length === 0) return { completed: 0, failed: 0 };
	try {
		const completed = await refreshClaimedHistoryArchiveCheckpointProofs(
			dataSource,
			targets
		);
		return { completed, failed: targets.length - completed };
	} catch (error) {
		if (targets.length === 1) {
			const target = targets[0];
			if (target === undefined) return { completed: 0, failed: 0 };
			await recordProofRefreshFailure(dataSource, target, error);
			return { completed: 0, failed: 1 };
		}
		const midpoint = Math.ceil(targets.length / 2);
		const first = await refreshProofRefreshBatchWithIsolation(
			dataSource,
			targets.slice(0, midpoint)
		);
		const second = await refreshProofRefreshBatchWithIsolation(
			dataSource,
			targets.slice(midpoint)
		);
		return {
			completed: first.completed + second.completed,
			failed: first.failed + second.failed
		};
	}
}

async function refreshClaimedHistoryArchiveCheckpointProofWave(
	manager: EntityManager,
	targets: readonly ClaimedHistoryArchiveCheckpointProofRefresh[]
): Promise<number> {
	const payload = JSON.stringify(targets);
	const [write] = (await manager.query(
		historyArchiveCheckpointProofBatchQueuedRefreshSql,
		[payload]
	)) as readonly ProofRefreshWriteResult[];
	const targetCount = Number(write?.targetCount ?? write?.targetcount ?? 0);
	const handledCount = Number(write?.handledCount ?? write?.handledcount ?? 0);
	if (targetCount !== targets.length || handledCount !== targets.length) {
		throw new Error(
			'Checkpoint proof batch handled ' +
				handledCount +
				'/' +
				targetCount +
				' valid targets for ' +
				targets.length +
				' claims'
		);
	}
	await manager.query(
		historyArchiveCheckpointProofPendingSourceBatchEnrichmentSql,
		[payload]
	);
	await materializeNextCompactCheckpointPlans(manager, targets);
	await materializeCompactCheckpointPlans(
		manager,
		targets.map((target) => target.archiveUrlIdentity)
	);
	await enqueueTargetedTerminalReadyCheckpointProofRefreshes(
		manager,
		targets.map((target) => target.archiveUrlIdentity)
	);
	const deleted = (await manager.query(completeProofRefreshBatchSql, [
		payload
	])) as unknown;
	const deletedRows = extractQueryRows<{ readonly checkpointLedger: number }>(
		deleted
	);
	if (deletedRows.length !== targets.length) {
		throw new Error(
			'Checkpoint proof batch completed ' +
				deletedRows.length +
				'/' +
				targets.length +
				' claims'
		);
	}
	return deletedRows.length;
}

async function claimLockedContiguousProofRefreshes(
	manager: EntityManager,
	initialTargets: readonly ClaimedHistoryArchiveCheckpointProofRefresh[],
	limit: number
): Promise<readonly ClaimedHistoryArchiveCheckpointProofRefresh[]> {
	if (limit <= 1 || initialTargets.length === 0) {
		return [];
	}
	const rows = (await manager.query(claimLockedContiguousProofRefreshSql, [
		JSON.stringify(initialTargets),
		limit
	])) as readonly (Omit<
		ClaimedHistoryArchiveCheckpointProofRefresh,
		'generation'
	> & { readonly generation: number | string })[];
	return rows.map((row) => ({
		...row,
		generation: Number(row.generation)
	}));
}

async function claimLockedSequentialProofRefreshes(
	manager: EntityManager,
	archiveUrlIdentities: readonly string[]
): Promise<readonly ClaimedHistoryArchiveCheckpointProofRefresh[]> {
	const rows = (await manager.query(claimLockedSequentialProofRefreshSql, [
		[...archiveUrlIdentities]
	])) as readonly (Omit<
		ClaimedHistoryArchiveCheckpointProofRefresh,
		'generation'
	> & { readonly generation: number | string })[];
	return rows.map((row) => ({
		...row,
		generation: Number(row.generation)
	}));
}

export async function refreshClaimedHistoryArchiveCheckpointProofs(
	dataSource: DataSource,
	targets: readonly ClaimedHistoryArchiveCheckpointProofRefresh[]
): Promise<number> {
	if (targets.length === 0) return 0;
	const archiveUrlIdentities = [
		...new Set(targets.map((target) => target.archiveUrlIdentity))
	];
	return await dataSource.transaction(async (manager) => {
		await manager.query(`set local lock_timeout = '10s'`);
		await manager.query(`set local statement_timeout = '60s'`);
		await lockHistoryArchiveRootTransitions(manager, archiveUrlIdentities);

		const transactionSize = consecutiveProofRefreshTransactionSize();
		if (targets.length !== 1) {
			const initialCompleted =
				await refreshClaimedHistoryArchiveCheckpointProofWave(manager, targets);
			for (let index = 1; index < transactionSize; index += 1) {
				const savepoint = 'history_archive_proof_chain_' + index;
				await manager.query('savepoint ' + savepoint);
				try {
					const nextTargets = await claimLockedSequentialProofRefreshes(
						manager,
						archiveUrlIdentities
					);
					if (nextTargets.length === 0) {
						await manager.query('release savepoint ' + savepoint);
						break;
					}
					await refreshClaimedHistoryArchiveCheckpointProofWave(
						manager,
						nextTargets
					);
					await manager.query('release savepoint ' + savepoint);
				} catch {
					await manager.query('rollback to savepoint ' + savepoint);
					await manager.query('release savepoint ' + savepoint);
					break;
				}
			}
			return initialCompleted;
		}

		const firstContiguousTargets = await claimLockedContiguousProofRefreshes(
			manager,
			targets,
			Math.min(maximumSetBasedConsecutiveProofRefreshWaveSize, transactionSize)
		);
		const firstWave = [...targets, ...firstContiguousTargets];
		await refreshClaimedHistoryArchiveCheckpointProofWave(manager, firstWave);
		let processed = firstWave.length;
		let wave = 1;
		while (processed < transactionSize) {
			const savepoint = 'history_archive_proof_vector_' + wave;
			await manager.query('savepoint ' + savepoint);
			try {
				const nextTargets = await claimLockedSequentialProofRefreshes(
					manager,
					archiveUrlIdentities
				);
				if (nextTargets.length === 0) {
					await manager.query('release savepoint ' + savepoint);
					break;
				}
				const vectorSize = Math.min(
					maximumSetBasedConsecutiveProofRefreshWaveSize,
					transactionSize - processed
				);
				const contiguousTargets = await claimLockedContiguousProofRefreshes(
					manager,
					nextTargets,
					vectorSize
				);
				const vector = [...nextTargets, ...contiguousTargets];
				await refreshClaimedHistoryArchiveCheckpointProofWave(manager, vector);
				processed += vector.length;
				await manager.query('release savepoint ' + savepoint);
			} catch {
				await manager.query('rollback to savepoint ' + savepoint);
				await manager.query('release savepoint ' + savepoint);
				break;
			}
			wave++;
		}
		return targets.length;
	});
}

async function recordProofRefreshFailure(
	dataSource: DataSource,
	target: ClaimedHistoryArchiveCheckpointProofRefresh,
	error: unknown
): Promise<void> {
	const message = error instanceof Error ? error.message : String(error);
	await dataSource.query(failProofRefreshSql, [
		target.archiveUrlIdentity,
		target.checkpointLedger,
		target.leaseToken,
		message.slice(0, 1_000),
		target.generation
	]);
}

function extractQueryRows<T>(result: unknown): readonly T[] {
	if (!Array.isArray(result)) return [];
	if (Array.isArray(result[0]) && typeof result[1] === 'number') {
		return result[0] as readonly T[];
	}
	return result as readonly T[];
}

export const enqueueProofRefreshesSql = `
	with source_objects as materialized (
		select object.*,
			greatest(
				object."updatedAt",
				coalesce(object."verifiedAt", '-infinity'::timestamptz),
				coalesce(
					object."transitionEffectsRequiredAt",
					'-infinity'::timestamptz
				)
			) as evidence_updated_at
		from "history_archive_object_queue" object
		where object."remoteId" = any($1::uuid[])
			and object.status in ('failed', 'verified')
	), affected as materialized (
		select source."archiveUrlIdentity", source."checkpointLedger",
			source.evidence_updated_at
		from source_objects source
		where source."checkpointLedger" is not null
		union all
		select source."archiveUrlIdentity", source."checkpointLedger" + 64,
			source.evidence_updated_at
		from source_objects source
		where source."objectType" = 'ledger'
			and source."checkpointLedger" is not null
			and source."checkpointLedger" <= 2147483583
		union all
		select dependency."archiveUrlIdentity", dependency."checkpointLedger",
			source.evidence_updated_at
		from source_objects source
		join "history_archive_checkpoint_bucket_dependency" dependency
			on source."objectType" = 'bucket'
			and dependency."archiveUrlIdentity" = source."archiveUrlIdentity"
			and dependency."bucketHash" = source."bucketHash"
        ), candidate_targets as materialized (
                select affected."archiveUrlIdentity", affected."checkpointLedger",
                        max(affected.evidence_updated_at) as evidence_updated_at
                from affected
                group by affected."archiveUrlIdentity", affected."checkpointLedger"
        ), targets as materialized (
                select candidate.*
                from candidate_targets candidate
                join "history_archive_checkpoint_scan_cursor" chain_cursor
                        on chain_cursor."archiveUrlIdentity" =
                                candidate."archiveUrlIdentity"
                        and candidate."checkpointLedger" =
                                chain_cursor."nextHistoricalCheckpointLedger" - 64
                where ${historyArchiveCheckpointProofTerminalReadySql('candidate')}
        ), enqueued as (
		insert into history_archive_checkpoint_proof_refresh_queue (
			"archiveUrlIdentity", "checkpointLedger", "evidenceUpdatedAt", generation,
			"requestedAt", "nextAttemptAt", "updatedAt"
		)
		select "archiveUrlIdentity", "checkpointLedger", evidence_updated_at, 1,
			now(), now(), now()
		from targets
order by "archiveUrlIdentity", "checkpointLedger"
                on conflict ("archiveUrlIdentity", "checkpointLedger") do update set
                        "evidenceUpdatedAt" = greatest(
                                history_archive_checkpoint_proof_refresh_queue."evidenceUpdatedAt",
                                excluded."evidenceUpdatedAt"
                        ),
                        generation =
                                history_archive_checkpoint_proof_refresh_queue.generation + 1,
                        "nextAttemptAt" = now(),
                        attempts = 0,
                        "lastError" = null,
                        "leaseToken" = null,
                        "leaseUntil" = null,
                        "updatedAt" = now()
                -- The generation fence prevents an older leased refresh from
                -- acknowledging or deleting this newly requested work.
		returning 1
	)
	select count(*)::integer as count from enqueued
`;

export const claimLockedContiguousProofRefreshSql = `
	with initial_targets as materialized (
		select distinct target."archiveUrlIdentity", target."checkpointLedger"
		from jsonb_to_recordset($1::jsonb) as target(
			"archiveUrlIdentity" text,
			"checkpointLedger" integer
		)
	), candidates as materialized (
		select initial."archiveUrlIdentity",
			initial."checkpointLedger" + (step.step_index * 64)::integer
				as "checkpointLedger"
		from initial_targets initial
		join "history_archive_checkpoint_scan_cursor" chain_cursor
			on chain_cursor."archiveUrlIdentity" =
				initial."archiveUrlIdentity"
			and initial."checkpointLedger" =
				chain_cursor."nextHistoricalCheckpointLedger" - 64
		cross join lateral generate_series(
			1,
			greatest($2::integer - 1, 0)
		) step(step_index)
		where initial."checkpointLedger" + (step.step_index * 64) <=
			chain_cursor."latestCheckpointLedger"
	), evaluated as materialized (
		select candidate.*,
			${historyArchiveCheckpointProofEvidenceTerminalSql('candidate')}
				as terminal
		from candidates candidate
	), ordered as materialized (
		select evaluated.*,
			bool_and(terminal) over (
				partition by "archiveUrlIdentity"
				order by "checkpointLedger"
				rows between unbounded preceding and current row
			) as contiguous
		from evaluated
	), claimable as materialized (
		select ordered."archiveUrlIdentity", ordered."checkpointLedger"
		from ordered
		where ordered.contiguous
			and not exists (
				select 1
				from "history_archive_checkpoint_proof" proof
				where proof."archiveUrlIdentity" =
					ordered."archiveUrlIdentity"
					and proof."checkpointLedger" =
						ordered."checkpointLedger"
					and proof.status = 'verified'
			)
		order by ordered."archiveUrlIdentity", ordered."checkpointLedger"
	), claimed as (
		insert into "history_archive_checkpoint_proof_refresh_queue" (
			"archiveUrlIdentity",
			"checkpointLedger",
			"evidenceUpdatedAt",
			generation,
			"requestedAt",
			"nextAttemptAt",
			"updatedAt",
			"leaseToken",
			"leaseUntil",
			"lastAttemptAt"
		)
		select claimable."archiveUrlIdentity", claimable."checkpointLedger",
			now(), 1, now(), now(), now(), gen_random_uuid(),
			now() + interval '2 minutes', now()
		from claimable
		on conflict ("archiveUrlIdentity", "checkpointLedger") do update
		set "leaseToken" = gen_random_uuid(),
			"leaseUntil" = now() + interval '2 minutes',
			"lastAttemptAt" = now(),
			"updatedAt" = now()
		where
			history_archive_checkpoint_proof_refresh_queue."nextAttemptAt" <= now()
			and (
				history_archive_checkpoint_proof_refresh_queue."leaseUntil" is null
				or history_archive_checkpoint_proof_refresh_queue."leaseUntil" <= now()
			)
		returning *
	)
	select "archiveUrlIdentity", "checkpointLedger",
		"evidenceUpdatedAt"::text as "evidenceUpdatedAt", generation, "leaseToken"
	from claimed
	order by "archiveUrlIdentity", "checkpointLedger"
`;
// Enqueue admission already proves terminal readiness. The sequential claimant
// binds that durable intent to the one open checkpoint per root instead of
// repeating the full object-and-bucket readiness graph for every queue claim.
export const claimLockedSequentialProofRefreshSql = `
	with candidate as materialized (
		select queue."archiveUrlIdentity", queue."checkpointLedger"
		from history_archive_checkpoint_proof_refresh_queue queue
		join "history_archive_checkpoint_scan_cursor" chain_cursor
			on chain_cursor."archiveUrlIdentity" =
				queue."archiveUrlIdentity"
			and queue."checkpointLedger" =
				chain_cursor."nextHistoricalCheckpointLedger" - 64
		where queue."archiveUrlIdentity" = any($1::text[])
			and queue."nextAttemptAt" <= now()
			and (queue."leaseUntil" is null or queue."leaseUntil" <= now())
		order by queue."nextAttemptAt", queue."requestedAt", queue.attempts,
			queue."archiveUrlIdentity", queue."checkpointLedger"
		for update of queue skip locked
	), claimed as (
		update history_archive_checkpoint_proof_refresh_queue queue
		set "leaseToken" = gen_random_uuid(),
			"leaseUntil" = now() + interval '2 minutes',
			"lastAttemptAt" = now(),
			"updatedAt" = now()
		from candidate
		where queue."archiveUrlIdentity" = candidate."archiveUrlIdentity"
			and queue."checkpointLedger" = candidate."checkpointLedger"
		returning queue.*
	)
	select "archiveUrlIdentity", "checkpointLedger",
		"evidenceUpdatedAt"::text as "evidenceUpdatedAt", generation, "leaseToken"
	from claimed
`;

export const claimSequentialProofRefreshSql = `
	with candidate as materialized (
		select queue."archiveUrlIdentity", queue."checkpointLedger"
		from history_archive_checkpoint_proof_refresh_queue queue
		join "history_archive_checkpoint_scan_cursor" chain_cursor
			on chain_cursor."archiveUrlIdentity" =
				queue."archiveUrlIdentity"
			and queue."checkpointLedger" =
				chain_cursor."nextHistoricalCheckpointLedger" - 64
		where queue."nextAttemptAt" <= now()
			and (queue."leaseUntil" is null or queue."leaseUntil" <= now())
		order by queue."nextAttemptAt", queue."requestedAt", queue.attempts,
			queue."archiveUrlIdentity", queue."checkpointLedger"
		for update of queue skip locked
		limit $1::integer
	), claimed as (
		update history_archive_checkpoint_proof_refresh_queue queue
		set "leaseToken" = gen_random_uuid(),
			"leaseUntil" = now() + interval '2 minutes',
			"lastAttemptAt" = now(),
			"updatedAt" = now()
		from candidate
		where queue."archiveUrlIdentity" = candidate."archiveUrlIdentity"
			and queue."checkpointLedger" = candidate."checkpointLedger"
		returning queue.*
	)
	select "archiveUrlIdentity", "checkpointLedger",
		"evidenceUpdatedAt"::text as "evidenceUpdatedAt", generation, "leaseToken"
	from claimed
`;

export const claimProofRefreshSql = `
	with due_proof_refresh_queue as materialized (
		select queue."archiveUrlIdentity", queue."checkpointLedger"
		from history_archive_checkpoint_proof_refresh_queue queue
		where queue."nextAttemptAt" <= now()
			and (queue."leaseUntil" is null or queue."leaseUntil" <= now())
	), ${canonicalRuntimeTargetCtes}, ${dueProofRefreshCanonicalRuntimeArchiveRootsCteSql}, current_canonical_proof_roots as materialized (
		select runtime_root."archiveUrlIdentity",
			runtime_root.checkpoint_ledger, runtime_root.target_lane
		from queued_canonical_runtime_roots runtime_root
		where ${canonicalRuntimeExecutableProofMemberExistsSql('runtime_root')}
	), candidate as materialized (
		select queue."archiveUrlIdentity", queue."checkpointLedger"
		from history_archive_checkpoint_proof_refresh_queue queue
		left join lateral (
			select min(case target.target_lane
				when 'forward' then 0 else 1 end) as priority
			from current_canonical_proof_roots target
			where target."archiveUrlIdentity" = queue."archiveUrlIdentity"
				and target.checkpoint_ledger = queue."checkpointLedger"
		) runtime on true
		where queue."nextAttemptAt" <= now()
			and (queue."leaseUntil" is null or queue."leaseUntil" <= now())
			and ($1::smallint >= 1 or runtime.priority is not null)
                        and ${historyArchiveCheckpointProofTerminalReadySql('queue')}
		order by runtime.priority nulls last, queue."nextAttemptAt",
			queue."requestedAt", queue.attempts,
			queue."archiveUrlIdentity", queue."checkpointLedger"
		for update of queue skip locked
		limit $2::integer
	), claimed as (
		update history_archive_checkpoint_proof_refresh_queue queue
		set "leaseToken" = gen_random_uuid(),
			"leaseUntil" = now() + interval '2 minutes',
			"lastAttemptAt" = now(),
			"updatedAt" = now()
		from candidate
		where queue."archiveUrlIdentity" = candidate."archiveUrlIdentity"
			and queue."checkpointLedger" = candidate."checkpointLedger"
		returning queue.*
	)
	select "archiveUrlIdentity", "checkpointLedger",
		"evidenceUpdatedAt"::text as "evidenceUpdatedAt", generation, "leaseToken"
	from claimed
`;

const lockClaimedProofRefreshSql = `
	select "leaseToken"
	from history_archive_checkpoint_proof_refresh_queue
	where "archiveUrlIdentity" = $1::text
		and "checkpointLedger" = $2::integer
		and "leaseToken" = $3::uuid
		and generation = $4::bigint
		and "leaseUntil" > now()
	for update
`;

const completeProofRefreshSql = `
	delete from history_archive_checkpoint_proof_refresh_queue
	where "archiveUrlIdentity" = $1::text
		and "checkpointLedger" = $2::integer
		and "leaseToken" = $3::uuid
		and generation = $4::bigint
	returning "checkpointLedger"
`;

const completeProofRefreshBatchSql = `
with targets as materialized (
select target."archiveUrlIdentity",
target."checkpointLedger",
target.generation,
target."leaseToken"
from jsonb_to_recordset($1::jsonb) as target(
"archiveUrlIdentity" text,
"checkpointLedger" integer,
generation bigint,
"leaseToken" uuid
)
)
delete from history_archive_checkpoint_proof_refresh_queue queue
using targets
where queue."archiveUrlIdentity" = targets."archiveUrlIdentity"
and queue."checkpointLedger" = targets."checkpointLedger"
and queue."leaseToken" = targets."leaseToken"
and queue.generation = targets.generation
returning queue."checkpointLedger"
`;

const failProofRefreshSql = `
	update history_archive_checkpoint_proof_refresh_queue
	set attempts = attempts + 1,
		"lastError" = $4::text,
		"nextAttemptAt" = now() + make_interval(
			secs => least(300, 5 * (1 << least(attempts, 6)))
		),
		"leaseToken" = null,
		"leaseUntil" = null,
		"updatedAt" = now()
	where "archiveUrlIdentity" = $1::text
		and "checkpointLedger" = $2::integer
		and "leaseToken" = $3::uuid
		and generation = $5::bigint
`;

export const proofRefreshQueueStatusSql = `
	select count(*)::integer as depth,
		count(*) filter (where attempts > 0)::integer as retrying,
		count(*) filter (
			where "leaseUntil" is not null and "leaseUntil" > now()
		)::integer as leased,
		coalesce(max(attempts), 0)::integer as "maximumAttempts",
		min("nextAttemptAt") as "oldestDueAt",
		min("requestedAt") as "oldestRequestedAt"
	from history_archive_checkpoint_proof_refresh_queue
`;
