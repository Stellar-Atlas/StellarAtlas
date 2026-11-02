import { mapCheckpointProofRefreshFailure } from './HistoryArchiveCheckpointProofRefreshFailure.js';
import { CURRENT_HISTORY_ARCHIVE_CHECKPOINT_PROOF_VERSION } from '../../../domain/history-archive-checkpoint-proof/HistoryArchiveCheckpointProof.js';
import { historyArchiveConsumerCount } from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveObjectPlanningPolicy.js';
import type { DataSource, EntityManager } from 'typeorm';
import type {
	HistoryArchiveCheckpointProofRefreshDrainResult,
	HistoryArchiveCheckpointProofRefreshFailure,
	HistoryArchiveCheckpointProofRefreshPriority
} from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveObjectRepository.js';
import {
	getHistoryArchiveCanonicalFirstRoot,
	historyArchiveCanonicalFirstAdmissionSql,
	historyArchiveCanonicalFirstScopeCteSql
} from './HistoryArchiveCanonicalFirst.js';
import { canonicalRuntimeTargetCtes } from './HistoryArchiveCanonicalRuntimeTargetSql.js';
import { materializeNextCompactCheckpointPlans } from './HistoryArchiveCompactPlanning.js';
import { dueProofRefreshCanonicalRuntimeArchiveRootsCteSql } from './HistoryArchiveCanonicalRuntimePrioritySql.js';
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
	historyArchiveRootTransitionLockNamespace,
	lockHistoryArchiveRootTransitions
} from './HistoryArchiveRootTransitionLock.js';
import { historyArchiveCheckpointBucketDependenciesSql } from './HistoryArchiveCheckpointDependencyReadSql.js';
import { historyArchiveStaleBucketProofRecoverySql } from './HistoryArchiveStaleBucketProofRecoverySql.js';
import { getCanonicalFrontierAlternateTargets } from './HistoryArchiveCanonicalFallbackTargets.js';
import {
	canonicalVerifiedBoundarySql,
	getCanonicalFallbackRoot
} from './HistoryArchiveCanonicalFallbackAnchorSql.js';
import { remoteCheckpointFailureExistsSql } from './HistoryArchiveCheckpointRemoteFailureSql.js';
import {
	claimCompletedProofReserveRefreshSql,
	historyArchiveCompletedProofReserveRefreshMemberSql
} from './HistoryArchiveCompletedProofReserveRefreshSql.js';

export interface ClaimedHistoryArchiveCheckpointProofRefresh {
	readonly archiveUrlIdentity: string;
	readonly checkpointLedger: number;
	readonly evidenceUpdatedAt: Date | string;
	readonly generation: number;
	readonly leaseToken: string;
}

interface ProofRefreshWriteResult {
	readonly lockedTargets?: readonly {
		readonly archiveUrlIdentity: string;
		readonly checkpointLedger: number;
	}[];
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

interface ProofRefreshAcknowledgedKey {
	readonly archiveUrlIdentity: string;
	readonly checkpointLedger: number;
}

async function acknowledgeFreshVerifiedProofRefreshes(
	manager: EntityManager,
	targets: readonly ClaimedHistoryArchiveCheckpointProofRefresh[]
): Promise<readonly ClaimedHistoryArchiveCheckpointProofRefresh[]> {
	if (targets.length === 0) return [];
	const rows = (await manager.query(acknowledgeFreshVerifiedProofRefreshSql, [
		JSON.stringify(targets)
	])) as readonly ProofRefreshAcknowledgedKey[];
	const acknowledgedKeys = new Set(
		rows.map((row) =>
			JSON.stringify([row.archiveUrlIdentity, row.checkpointLedger])
		)
	);
	return targets.filter((target) =>
		acknowledgedKeys.has(
			JSON.stringify([target.archiveUrlIdentity, target.checkpointLedger])
		)
	);
}

/** Delete only a leased request already covered by an exact current verified
 * proof and its matching verified checkpoint-state object. No proof evidence
 * is updated and no checkpoint derivation is performed by this fast path. */
export const acknowledgeFreshVerifiedProofRefreshSql = `
with targets as materialized (
	select target."archiveUrlIdentity", target."checkpointLedger",
		target.generation, target."leaseToken", target."evidenceUpdatedAt"
	from jsonb_to_recordset($1::jsonb) as target(
		"archiveUrlIdentity" text,
		"checkpointLedger" integer,
		"evidenceUpdatedAt" timestamptz,
		generation bigint,
		"leaseToken" uuid
	)
), satisfied as materialized (
	select queue."archiveUrlIdentity", queue."checkpointLedger",
		queue.generation, queue."leaseToken", queue."evidenceUpdatedAt"
	from targets target
	join history_archive_checkpoint_proof_refresh_queue queue
		on queue."archiveUrlIdentity" = target."archiveUrlIdentity"
		and queue."checkpointLedger" = target."checkpointLedger"
		and queue.generation = target.generation
		and queue."leaseToken" = target."leaseToken"
		and queue."evidenceUpdatedAt" = target."evidenceUpdatedAt"
		and queue."leaseUntil" > now()
	join "history_archive_checkpoint_proof" proof
		on proof."archiveUrlIdentity" = queue."archiveUrlIdentity"
		and proof."checkpointLedger" = queue."checkpointLedger"
		and proof.status = 'verified'
		and proof."proofVersion" = ${CURRENT_HISTORY_ARCHIVE_CHECKPOINT_PROOF_VERSION}
		and proof."requiredObjectsComplete" is true
		and proof."proofFactsComplete" is true
		and proof."bucketsVerified" is true
	join "history_archive_object_queue" checkpoint
		on checkpoint."archiveUrlIdentity" = proof."archiveUrlIdentity"
		and checkpoint."checkpointLedger" = proof."checkpointLedger"
		and checkpoint."objectType" = 'checkpoint-state'
		and checkpoint.status = 'verified'
		and checkpoint."remoteId" = proof."checkpointStateObjectRemoteId"
	where target."evidenceUpdatedAt" <= greatest(
		proof."evaluatedAt",
		coalesce(checkpoint."proofReconciledAt", '-infinity'::timestamptz)
	)
), deleted as (
	delete from history_archive_checkpoint_proof_refresh_queue queue
	using satisfied target
	where queue."archiveUrlIdentity" = target."archiveUrlIdentity"
		and queue."checkpointLedger" = target."checkpointLedger"
		and queue.generation = target.generation
		and queue."leaseToken" = target."leaseToken"
		and queue."evidenceUpdatedAt" = target."evidenceUpdatedAt"
		and queue."leaseUntil" > now()
	returning queue."archiveUrlIdentity", queue."checkpointLedger"
)
select "archiveUrlIdentity", "checkpointLedger" from deleted
`;

export const defaultTargetedProofRefreshBatchSize = historyArchiveConsumerCount;
export const maximumTargetedProofRefreshBatchSize = historyArchiveConsumerCount;

const defaultConsecutiveProofRefreshTransactionSize = 16;
const maximumConsecutiveProofRefreshTransactionSize = 64;

const maximumSetBasedConsecutiveProofRefreshWaveSize =
	maximumConsecutiveProofRefreshTransactionSize;

export function proofRefreshBatchHandledEveryValidTarget(
	claimCount: number,
	targetCount: number,
	handledCount: number
): boolean {
	return (
		Number.isSafeInteger(targetCount) &&
		targetCount >= 0 &&
		targetCount <= claimCount &&
		handledCount === targetCount
	);
}

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
		[...remoteIds],
		getCanonicalFallbackRoot()
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
	const queued = Number(row?.count ?? 0);
	const alternateTargets = await getCanonicalFrontierAlternateTargets(manager);
	if (alternateTargets.length === 0) return queued;
	return (
		queued +
		(await enqueueHistoryArchiveCheckpointProofRefreshes(
			manager,
			alternateTargets.map((target) => target.remoteId)
		))
	);
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
	const queued = Number(row?.count ?? 0);
	const alternateTargets = await getCanonicalFrontierAlternateTargets(manager);
	const selected = alternateTargets.filter((target) =>
		uniqueIdentities.includes(target.archiveUrlIdentity)
	);
	if (selected.length === 0) return queued;
	return (
		queued +
		(await enqueueHistoryArchiveCheckpointProofRefreshes(
			manager,
			selected.map((target) => target.remoteId)
		))
	);
}

export const enqueueCurrentTerminalReadyCheckpointProofRefreshesSql = `
        with candidates as materialized (
                select cursor."archiveUrlIdentity",
                        cursor."nextHistoricalCheckpointLedger" - 64
                                as "checkpointLedger"
                from "history_archive_checkpoint_scan_cursor" cursor
                where ($1::text[] is null or cursor."archiveUrlIdentity" = any($1::text[]))
                -- Existing verified proofs are reconciled from the durable
                -- proofReconciledAt watermark when their evidence changes.
                -- Recovery seeding only repairs a missing proof row, an
                -- interrupted pending proof, or terminal missing-object evidence
                -- that can advance through a canonical substitution, or a
                -- bucket proof whose last valid completion lost its wake.
                and not exists (
                        select 1
                        from "history_archive_checkpoint_substitution" substitution
                        where substitution."archiveUrlIdentity" =
                                cursor."archiveUrlIdentity"
                        and substitution."checkpointLedger" =
                                cursor."nextHistoricalCheckpointLedger" - 64
                )
                and (
                        not exists (
                                select 1
                                from "history_archive_checkpoint_proof" proof
                                where proof."archiveUrlIdentity" =
                                        cursor."archiveUrlIdentity"
                                and proof."checkpointLedger" =
                                        cursor."nextHistoricalCheckpointLedger" - 64
                        )
                        or exists (
                                select 1
                                from "history_archive_checkpoint_proof" proof
                                where proof."archiveUrlIdentity" =
                                        cursor."archiveUrlIdentity"
                                and proof."checkpointLedger" =
                                        cursor."nextHistoricalCheckpointLedger" - 64
                                and (
                                        proof.status = 'pending'
                                        or ${historyArchiveStaleBucketProofRecoverySql('proof')}
                                        or (
                                                proof.status = 'not-evaluable'
                                                and proof."failureKind" in (
                                                        'object-failed',
                                                        'bucket-missing'
                                                )
                                                and (
                                                        proof.details->>'failureHttpStatus' in (
                                                                '403', '404', '410'
                                                        )
                                                        or exists (
                                                                select 1
                                                                from "history_archive_object_queue" failed
                                                                where failed."archiveUrlIdentity" =
                                                                        cursor."archiveUrlIdentity"
                                                                and failed."checkpointLedger" =
                                                                        cursor."nextHistoricalCheckpointLedger" - 64
                                                                and failed.status = 'failed'
                                                                and failed."httpStatus" in (403, 404, 410)
                                                        )
                                                        or exists (
                                                                select 1
                                                                from jsonb_array_elements(
                                                                        case
                                                                                when jsonb_typeof(
                                                                                        proof.details->'objectFailures'
                                                                                ) = 'array'
                                                                                then proof.details->'objectFailures'
                                                                                else '[]'::jsonb
                                                                        end
                                                                ) prior_failure
                                                                join "history_archive_object_queue" recovered
                                                                        on recovered."remoteId" = case
                                                                                when prior_failure->>'remoteId' ~
                                                                                        '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
                                                                                then (prior_failure->>'remoteId')::uuid
                                                                        end
                                                                        and recovered.status = 'verified'
                                                        )
                                                )
                                        )
                                )
                        )
                )
                and not exists (
                        select 1
                        from "history_archive_checkpoint_proof_refresh_queue" queued
                        where queued."archiveUrlIdentity" =
                                cursor."archiveUrlIdentity"
                        and queued."checkpointLedger" =
                                cursor."nextHistoricalCheckpointLedger" - 64
                )
                and pg_try_advisory_xact_lock(
                        ${historyArchiveRootTransitionLockNamespace},
                        hashtext(cursor."archiveUrlIdentity")
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
	// The claim is already a bounded set. Keep it set-based: splitting it by
	// root recreated one long PostgreSQL writer per archive and made those
	// writers contend on the same proof and refresh-queue index pages.
	const outcome = await refreshProofRefreshBatchWithIsolation(
		dataSource,
		targets
	);
	return {
		claimed: targets.length,
		completed: outcome.completed,
		failed: outcome.failed,
		superseded: outcome.superseded,
		...(outcome.failures === undefined ? {} : { failures: outcome.failures })
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
		const canonicalFirstRoot = getHistoryArchiveCanonicalFirstRoot();
		const canonicalFallbackRoot = getCanonicalFallbackRoot();
		let rows: readonly (Omit<
			ClaimedHistoryArchiveCheckpointProofRefresh,
			'generation'
		> & { readonly generation: number | string })[] = [];
		// Reserve the first slot for the one admitted canonical-frontier alternate
		// before draining the ordinary sequential queue. Keep the same batch cap;
		// remaining slots continue through the existing queue order below.
		if (maximumPriority === 1 && canonicalFallbackRoot !== null) {
			const [alternate] = await getCanonicalFrontierAlternateTargets(manager);
			if (alternate !== undefined) {
				rows = (await manager.query(
					claimCanonicalFrontierAlternateProofRefreshSql,
					[
						alternate.archiveUrlIdentity,
						alternate.checkpointLedger,
						canonicalFallbackRoot
					]
				)) as typeof rows;
			}
		}
		if (maximumPriority === 1 && rows.length < safeLimit) {
			const reserveRows = (await manager.query(
				claimCompletedProofReserveRefreshSql
			)) as typeof rows;
			rows = [...rows, ...reserveRows];
		}
		const claimSql =
			maximumPriority === 1
				? claimSequentialProofRefreshSql
				: claimProofRefreshSql;
		if (maximumPriority !== 1) {
			rows = (await manager.query(claimSql, [
				maximumPriority,
				safeLimit
			])) as typeof rows;
		} else if (rows.length < safeLimit) {
			const remaining = safeLimit - rows.length;
			let sequentialRows = (await manager.query(
				claimSequentialProofRefreshSql,
				[canonicalFirstRoot, remaining]
			)) as typeof rows;
			if (sequentialRows.length === 0 && canonicalFirstRoot !== null) {
				sequentialRows = (await manager.query(claimSequentialProofRefreshSql, [
					null,
					remaining
				])) as typeof rows;
			}
			rows = [...rows, ...sequentialRows];
		}
		if (maximumPriority === 1 && rows.length < safeLimit) {
			const staleRows = (await manager.query(
				claimStaleVerifiedProofRefreshSql,
				[safeLimit - rows.length]
			)) as typeof rows;
			rows = [...rows, ...staleRows];
		}
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
		const fastAcknowledged = await acknowledgeFreshVerifiedProofRefreshes(
			manager,
			[target]
		);
		if (fastAcknowledged.length === 1) return true;

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
		// Commit proof evidence before the execution reconciler admits the next
		// checkpoint. Scheduler locks must never hold a computed proof open.
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
	readonly superseded: number;
	readonly failed: number;
	readonly failures?: readonly HistoryArchiveCheckpointProofRefreshFailure[];
}

async function refreshProofRefreshBatchWithIsolation(
	dataSource: DataSource,
	targets: readonly ClaimedHistoryArchiveCheckpointProofRefresh[]
): Promise<ProofRefreshBatchOutcome> {
	if (targets.length === 0) return { completed: 0, superseded: 0, failed: 0 };
	try {
		const outcome = await refreshClaimedHistoryArchiveCheckpointProofs(
			dataSource,
			targets
		);
		return { ...outcome, failed: 0 };
	} catch (error) {
		if (targets.length === 1) {
			const target = targets[0];
			if (target === undefined)
				return { completed: 0, superseded: 0, failed: 0 };
			const failure = await recordProofRefreshFailure(
				dataSource,
				target,
				error
			);
			return { completed: 0, superseded: 0, failed: 1, failures: [failure] };
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
			superseded: first.superseded + second.superseded,
			failed: first.failed + second.failed,
			failures: [...(first.failures ?? []), ...(second.failures ?? [])]
		};
	}
}

async function refreshClaimedHistoryArchiveCheckpointProofWave(
	manager: EntityManager,
	targets: readonly ClaimedHistoryArchiveCheckpointProofRefresh[]
): Promise<readonly ClaimedHistoryArchiveCheckpointProofRefresh[]> {
	const fastAcknowledged = await acknowledgeFreshVerifiedProofRefreshes(
		manager,
		targets
	);
	const acknowledgedKeys = new Set(
		fastAcknowledged.map((target) =>
			JSON.stringify([target.archiveUrlIdentity, target.checkpointLedger])
		)
	);
	const remainingTargets = targets.filter(
		(target) =>
			!acknowledgedKeys.has(
				JSON.stringify([target.archiveUrlIdentity, target.checkpointLedger])
			)
	);
	if (remainingTargets.length === 0) return fastAcknowledged;
	const payload = JSON.stringify(remainingTargets);
	const [write] = (await manager.query(
		historyArchiveCheckpointProofBatchQueuedRefreshSql,
		[payload]
	)) as readonly ProofRefreshWriteResult[];
	const targetCount = Number(write?.targetCount ?? write?.targetcount ?? 0);
	const handledCount = Number(write?.handledCount ?? write?.handledcount ?? 0);
	// Only the SQL-locked claims may be acknowledged. A locked claim with no
	// derivable target is an actual failure, not superseded work.
	const lockedTargets = write?.lockedTargets;
	const lockedKeys = new Set(
		lockedTargets?.map((target) =>
			JSON.stringify([target.archiveUrlIdentity, target.checkpointLedger])
		)
	);
	const completedTargets = targets.filter((target) =>
		lockedKeys.has(
			JSON.stringify([target.archiveUrlIdentity, target.checkpointLedger])
		)
	);
	if (
		lockedTargets === undefined ||
		lockedTargets.length !== completedTargets.length ||
		lockedTargets.length !== targetCount ||
		!proofRefreshBatchHandledEveryValidTarget(
			remainingTargets.length,
			targetCount,
			handledCount
		)
	) {
		throw new Error(
			'Checkpoint proof batch handled ' +
				handledCount +
				'/' +
				targetCount +
				' valid targets for ' +
				remainingTargets.length +
				' claims'
		);
	}
	if (completedTargets.length === 0) return fastAcknowledged;
	const completedPayload = JSON.stringify(completedTargets);
	await manager.query(
		historyArchiveCheckpointProofPendingSourceBatchEnrichmentSql,
		[completedPayload]
	);
	// Next-checkpoint admission and terminal recovery run from durable proof
	// state after this transaction commits.
	const deleted = (await manager.query(completeProofRefreshBatchSql, [
		completedPayload
	])) as unknown;
	const deletedRows = extractQueryRows<{ readonly checkpointLedger: number }>(
		deleted
	);
	if (deletedRows.length !== completedTargets.length) {
		throw new Error(
			'Checkpoint proof batch completed ' +
				deletedRows.length +
				'/' +
				completedTargets.length +
				' active claims'
		);
	}
	return [...fastAcknowledged, ...completedTargets];
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
): Promise<{ readonly completed: number; readonly superseded: number }> {
	if (targets.length === 0) return { completed: 0, superseded: 0 };
	const archiveUrlIdentities = [
		...new Set(targets.map((target) => target.archiveUrlIdentity))
	];
	return await dataSource.transaction(async (manager) => {
		await manager.query(`set local lock_timeout = '10s'`);
		await manager.query(`set local statement_timeout = '60s'`);
		await lockHistoryArchiveRootTransitions(manager, archiveUrlIdentities);

		const completedTargets: ClaimedHistoryArchiveCheckpointProofRefresh[] = [];
		const transactionSize = consecutiveProofRefreshTransactionSize();
		if (targets.length !== 1) {
			const initialCompleted =
				await refreshClaimedHistoryArchiveCheckpointProofWave(manager, targets);
			completedTargets.push(...initialCompleted);
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
					completedTargets.push(
						...(await refreshClaimedHistoryArchiveCheckpointProofWave(
							manager,
							nextTargets
						))
					);
					await manager.query('release savepoint ' + savepoint);
				} catch {
					await manager.query('rollback to savepoint ' + savepoint);
					await manager.query('release savepoint ' + savepoint);
					break;
				}
			}
			await materializeNextCompactCheckpointPlans(manager, completedTargets);
			return {
				completed: initialCompleted.length,
				superseded: targets.length - initialCompleted.length
			};
		}
		const firstContiguousTargets = await claimLockedContiguousProofRefreshes(
			manager,
			targets,
			Math.min(maximumSetBasedConsecutiveProofRefreshWaveSize, transactionSize)
		);
		const firstWave = [...targets, ...firstContiguousTargets];
		const firstCompleted =
			await refreshClaimedHistoryArchiveCheckpointProofWave(manager, firstWave);
		completedTargets.push(...firstCompleted);
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
				completedTargets.push(
					...(await refreshClaimedHistoryArchiveCheckpointProofWave(
						manager,
						vector
					))
				);
				processed += vector.length;
				await manager.query('release savepoint ' + savepoint);
			} catch {
				await manager.query('rollback to savepoint ' + savepoint);
				await manager.query('release savepoint ' + savepoint);
				break;
			}
			wave++;
		}
		await materializeNextCompactCheckpointPlans(manager, completedTargets);
		const completed = targets.filter((target) =>
			firstCompleted.includes(target)
		).length;
		return { completed, superseded: targets.length - completed };
	});
}
export async function recordProofRefreshFailure(
	dataSource: DataSource,
	target: ClaimedHistoryArchiveCheckpointProofRefresh,
	error: unknown
): Promise<HistoryArchiveCheckpointProofRefreshFailure> {
	const message = error instanceof Error ? error.message : String(error);
	const recorded = await dataSource.query(failProofRefreshSql, [
		target.archiveUrlIdentity,
		target.checkpointLedger,
		target.leaseToken,
		message.slice(0, 1_000),
		target.generation
	]);
	return mapCheckpointProofRefreshFailure(
		target,
		error,
		extractQueryRows(recorded).length > 0
	);
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
		select object."remoteId", object."archiveUrlIdentity", object."checkpointLedger",
			object."objectType", object."bucketHash",
			case
				when object.status = 'verified' then greatest(
					coalesce(object."verifiedAt", object."updatedAt"),
					coalesce(
						object."transitionEffectsRequiredAt",
						'-infinity'::timestamptz
					)
				)
				else object."updatedAt"
			end as evidence_updated_at
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
		join "history_archive_checkpoint_scan_cursor" chain_cursor
			on source."objectType" = 'bucket'
			and chain_cursor."archiveUrlIdentity" = source."archiveUrlIdentity"
		cross join lateral (
			${historyArchiveCheckpointBucketDependenciesSql(
				'source."archiveUrlIdentity"',
				'chain_cursor."nextHistoricalCheckpointLedger" - 64'
			)}
		) dependency
		where dependency."bucketHash" = source."bucketHash"
        union all
        select source."archiveUrlIdentity",
                canonical_cursor."nextHistoricalCheckpointLedger" - 64,
                source.evidence_updated_at
        from source_objects source
        join "history_archive_checkpoint_scan_cursor" canonical_cursor
                on canonical_cursor."archiveUrlIdentity" = $2::text
                and canonical_cursor."nextHistoricalCheckpointLedger" is not null
        join "history_archive_state_snapshot" canonical_state
                on canonical_state."archiveUrlIdentity" = canonical_cursor."archiveUrlIdentity"
                and canonical_state.status = 'available'
        join "history_archive_state_snapshot" alternate_state
                on alternate_state."archiveUrlIdentity" = source."archiveUrlIdentity"
                and alternate_state.status = 'available'
                and alternate_state."networkPassphrase" = canonical_state."networkPassphrase"
        join "history_archive_checkpoint_proof" failed_frontier
                on failed_frontier."archiveUrlIdentity" = canonical_cursor."archiveUrlIdentity"
                and failed_frontier."checkpointLedger" =
                        canonical_cursor."nextHistoricalCheckpointLedger" - 64
                and failed_frontier.status = 'not-evaluable'
                and failed_frontier."failureKind" = 'object-failed'
        join "history_archive_object_queue" alternate_checkpoint
                on alternate_checkpoint."archiveUrlIdentity" = source."archiveUrlIdentity"
                and alternate_checkpoint."objectType" = 'checkpoint-state'
                and alternate_checkpoint."objectKey" = 'checkpoint-state:' ||
                        lpad(to_hex(canonical_cursor."nextHistoricalCheckpointLedger" - 64), 8, '0')
                and alternate_checkpoint."executionReason" =
                        'canonical-frontier-alternate'
                and alternate_checkpoint.status = 'verified'
        left join lateral (
                ${historyArchiveCheckpointBucketDependenciesSql(
									'source."archiveUrlIdentity"',
									'canonical_cursor."nextHistoricalCheckpointLedger" - 64'
								)}
        ) alternate_dependency on true
        where (
                (source."objectType" = 'checkpoint-state'
                        and source."remoteId" = alternate_checkpoint."remoteId")
                or (source."objectType" = 'bucket'
                        and source."bucketHash" = alternate_dependency."bucketHash"
                        and alternate_dependency."archiveUrlIdentity" = source."archiveUrlIdentity")
        )
                and ${remoteCheckpointFailureExistsSql('failed_frontier')}
        ), candidate_targets as materialized (
                select affected."archiveUrlIdentity", affected."checkpointLedger",
                        max(affected.evidence_updated_at) as evidence_updated_at
                from affected
                group by affected."archiveUrlIdentity", affected."checkpointLedger"
        ), pending_targets as materialized (
                select candidate.*
                from candidate_targets candidate
                where not exists (
                        select 1
                        from "history_archive_checkpoint_proof_refresh_queue" queued
                        where queued."archiveUrlIdentity" = candidate."archiveUrlIdentity"
                                and queued."checkpointLedger" = candidate."checkpointLedger"
                                and queued."evidenceUpdatedAt" >= candidate.evidence_updated_at
                )
                -- Skip covered notifications before dependency readiness and root
                -- locks. A consumer retires this row only atomically with handled
                -- proof evidence. Newer evidence still reaches the final upsert
                -- fence, including when an older claim is concurrently retired.
        ), lockable_roots as materialized (
                select root."archiveUrlIdentity"
                from (
                        select distinct candidate."archiveUrlIdentity"
                        from pending_targets candidate
                ) root
                where pg_try_advisory_xact_lock(
                        ${historyArchiveRootTransitionLockNamespace},
                        hashtext(root."archiveUrlIdentity")
                )
        ), targets as materialized (
                select candidate.*
                from pending_targets candidate
                join lockable_roots lockable
                        on lockable."archiveUrlIdentity" =
                                candidate."archiveUrlIdentity"
                join "history_archive_checkpoint_scan_cursor" chain_cursor
                        on chain_cursor."archiveUrlIdentity" =
                                candidate."archiveUrlIdentity"
                        and (
                                candidate."checkpointLedger" =
                                        chain_cursor."nextHistoricalCheckpointLedger" - 64
                                or ${historyArchiveCompletedProofReserveRefreshMemberSql('candidate')}
                                or exists (
                                        select 1
                                        from "history_archive_object_queue" alternate_checkpoint
                                        where alternate_checkpoint."archiveUrlIdentity" =
                                                candidate."archiveUrlIdentity"
                                        and alternate_checkpoint."objectType" = 'checkpoint-state'
                                        and alternate_checkpoint."objectKey" =
                                                'checkpoint-state:' || lpad(
                                                        to_hex(candidate."checkpointLedger"), 8, '0'
                                                )
                                        and alternate_checkpoint."executionReason" =
                                                'canonical-frontier-alternate'
                                        and alternate_checkpoint.status = 'verified'
                                )
                        )
                where ${historyArchiveCheckpointProofTerminalReadySql('candidate')}
                        and not exists (
                                select 1
                                from "history_archive_checkpoint_proof" proof
                                left join "history_archive_object_queue" checkpoint
                                        on checkpoint."archiveUrlIdentity" =
                                                proof."archiveUrlIdentity"
                                        and checkpoint."checkpointLedger" =
                                                proof."checkpointLedger"
                                        and checkpoint."objectType" =
                                                'checkpoint-state'
                                where proof."archiveUrlIdentity" =
                                        candidate."archiveUrlIdentity"
                                        and proof."checkpointLedger" =
                                                candidate."checkpointLedger"
                                        and greatest(
                                                proof."evaluatedAt",
                                                coalesce(
                                                        checkpoint."proofReconciledAt",
                                                        '-infinity'::timestamptz
                                                )
                                        ) >= candidate.evidence_updated_at
                        )
        ), enqueued as (
		insert into history_archive_checkpoint_proof_refresh_queue (
			"archiveUrlIdentity", "checkpointLedger", "evidenceUpdatedAt", generation,
			"requestedAt", "nextAttemptAt", "updatedAt", "refreshKind"
		)
		select "archiveUrlIdentity", "checkpointLedger", evidence_updated_at, 1,
			now(), now(), now(),
			case when ${historyArchiveCompletedProofReserveRefreshMemberSql('candidate')}
				then 'header-proof-repair' else null end
		from targets candidate
order by "archiveUrlIdentity", "checkpointLedger"
                on conflict ("archiveUrlIdentity", "checkpointLedger") do update set
                        "evidenceUpdatedAt" = greatest(
                                history_archive_checkpoint_proof_refresh_queue."evidenceUpdatedAt",
                                excluded."evidenceUpdatedAt"
                        ),
                        generation =
                                history_archive_checkpoint_proof_refresh_queue.generation + 1,
                        "refreshKind" = excluded."refreshKind",
                        "nextAttemptAt" = now(),
                        attempts = 0,
                        "lastError" = null,
                        "leaseToken" = null,
                        "leaseUntil" = null,
                        "updatedAt" = now()
                where excluded."evidenceUpdatedAt" >
                        history_archive_checkpoint_proof_refresh_queue."evidenceUpdatedAt"
                -- Only genuinely newer evidence supersedes a leased refresh.
                -- Replaying the same completion batch must not reset its lease,
                -- increment its generation, or create a redundant write.
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
	with ${historyArchiveCanonicalFirstScopeCteSql('$1::text')}, candidate as materialized (
		select queue."archiveUrlIdentity", queue."checkpointLedger"
		from history_archive_checkpoint_proof_refresh_queue queue
		join "history_archive_checkpoint_scan_cursor" chain_cursor
			on chain_cursor."archiveUrlIdentity" =
				queue."archiveUrlIdentity"
			and queue."checkpointLedger" =
				chain_cursor."nextHistoricalCheckpointLedger" - 64
		where queue."nextAttemptAt" <= now()
			and (queue."leaseUntil" is null or queue."leaseUntil" <= now())
			and ${historyArchiveCanonicalFirstAdmissionSql('queue."archiveUrlIdentity"', '$1::text')}
		order by queue."nextAttemptAt", queue."requestedAt", queue.attempts,
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

export const claimStaleVerifiedProofRefreshSql = `
	with oldest_due as materialized (
		select queue."archiveUrlIdentity", queue."checkpointLedger"
		from history_archive_checkpoint_proof_refresh_queue queue
		where queue."nextAttemptAt" <= now()
			and (queue."leaseUntil" is null or queue."leaseUntil" <= now())
		order by queue."nextAttemptAt", queue."requestedAt",
			queue."archiveUrlIdentity", queue."checkpointLedger"
		for update of queue skip locked
		limit 256
	), stale_verified as materialized (
		select queue."archiveUrlIdentity", queue."checkpointLedger"
		from oldest_due due
		join history_archive_checkpoint_proof_refresh_queue queue
			on queue."archiveUrlIdentity" = due."archiveUrlIdentity"
			and queue."checkpointLedger" = due."checkpointLedger"
		join "history_archive_checkpoint_proof" proof
			on proof."archiveUrlIdentity" = queue."archiveUrlIdentity"
			and proof."checkpointLedger" = queue."checkpointLedger"
			and proof.status = 'verified'
		left join "history_archive_checkpoint_scan_cursor" chain_cursor
			on chain_cursor."archiveUrlIdentity" = queue."archiveUrlIdentity"
		where (
				chain_cursor."nextHistoricalCheckpointLedger" is null
				or queue."checkpointLedger" <>
					chain_cursor."nextHistoricalCheckpointLedger" - 64
			)
			and ${historyArchiveCheckpointProofTerminalReadySql('queue')}
		order by queue."nextAttemptAt", queue."requestedAt",
			queue."archiveUrlIdentity", queue."checkpointLedger"
		for update of queue skip locked
		limit $1::integer
	), claimed as (
		update history_archive_checkpoint_proof_refresh_queue queue
		set "leaseToken" = gen_random_uuid(),
			"leaseUntil" = now() + interval '2 minutes',
			"lastAttemptAt" = now(),
			"updatedAt" = now()
		from stale_verified candidate
		where queue."archiveUrlIdentity" = candidate."archiveUrlIdentity"
			and queue."checkpointLedger" = candidate."checkpointLedger"
		returning queue.*
	)
	select "archiveUrlIdentity", "checkpointLedger",
		"evidenceUpdatedAt"::text as "evidenceUpdatedAt", generation, "leaseToken"
	from claimed
`;

/** Claim only the admitted alternate for the live canonical frontier. Its
 * predecessor must remain an authenticated canonical boundary (or recorded
 * substitution), as checked by terminal readiness and the boundary helper. */
export const claimCanonicalFrontierAlternateProofRefreshSql = `
	with canonical as materialized (
		select cursor."archiveUrlIdentity",
			cursor."nextHistoricalCheckpointLedger" - 64 as "checkpointLedger"
		from "history_archive_checkpoint_scan_cursor" cursor
		where cursor."archiveUrlIdentity" = $3::text
	), candidate as materialized (
		select queue."archiveUrlIdentity", queue."checkpointLedger"
		from history_archive_checkpoint_proof_refresh_queue queue
		join canonical on canonical."checkpointLedger" = queue."checkpointLedger"
		join "history_archive_object_queue" alternate
			on alternate."archiveUrlIdentity" = queue."archiveUrlIdentity"
			and alternate."checkpointLedger" = queue."checkpointLedger"
			and alternate."objectType" = 'checkpoint-state'
			and alternate."executionReason" = 'canonical-frontier-alternate'
			and alternate.status = 'verified'
		where queue."archiveUrlIdentity" = $1::text
			and queue."checkpointLedger" = $2::integer
			and queue."nextAttemptAt" <= now()
			and (queue."leaseUntil" is null or queue."leaseUntil" <= now())
			and exists (
				${canonicalVerifiedBoundarySql('$3::text', 'queue."checkpointLedger" - 64')}
			)
			and ${historyArchiveCheckpointProofTerminalReadySql('queue', false)}
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
target."leaseToken",
target."evidenceUpdatedAt"
from jsonb_to_recordset($1::jsonb) as target(
"archiveUrlIdentity" text,
"checkpointLedger" integer,
generation bigint,
"leaseToken" uuid,
"evidenceUpdatedAt" timestamptz
)
)
delete from history_archive_checkpoint_proof_refresh_queue queue
using targets
where queue."archiveUrlIdentity" = targets."archiveUrlIdentity"
and queue."checkpointLedger" = targets."checkpointLedger"
and queue."leaseToken" = targets."leaseToken"
and queue.generation = targets.generation
and queue."evidenceUpdatedAt" = targets."evidenceUpdatedAt"
and queue."leaseUntil" > now()
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
	returning "archiveUrlIdentity"
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
