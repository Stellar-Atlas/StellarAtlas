import type { Repository } from 'typeorm';
import type { HistoryArchiveObject } from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveObject.js';
import type { HistoryArchiveObjectExecutionReconciliationResult } from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveObjectRepository.js';
import {
	calculateHistoryArchivePlanningPressure,
	historyArchiveConsumerCount,
	historyArchiveMaximumWatermark,
	historyArchiveMinimumWatermark,
	historyArchivePerHostConcurrency,
	historyArchivePerRootFrontier,
	historyArchiveThroughputSampleCap,
	historyArchiveThroughputWindowMinutes
} from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveObjectPlanningPolicy.js';
import {
	admitCanonicalFrontierSql,
	materializeCanonicalFrontierDependenciesSql
} from './HistoryArchiveCanonicalFrontierSql.js';
import { backfillLegacyCheckpointContentDigests } from './HistoryArchiveLegacyCheckpointDigestBackfill.js';
import {
	historyArchiveObjectFrontierSql,
	seedHistoryArchiveFrontierCursorsSql
} from './HistoryArchiveObjectFrontierSql.js';

const reconciliationLockName = 'history_archive_execution_reconciliation';

interface PressureRow {
	readonly outstandingObjects: number | string;
	readonly recentCompletions: number | string;
}

interface AdmissionRow {
	readonly admittedObjects: number | string;
	readonly cursorAdvances: number | string;
}

export async function reconcileHistoryArchiveObjectExecution(
	repository: Repository<HistoryArchiveObject>
): Promise<HistoryArchiveObjectExecutionReconciliationResult> {
	return await repository.manager.transaction(async (manager) => {
		await manager.query(`set local lock_timeout = '500ms'`);
		await manager.query(`set local statement_timeout = '30s'`);
		await manager.query(`set local jit = off`);
		const [lock] = (await manager.query(
			'select pg_try_advisory_xact_lock(hashtext($1)) as locked',
			[reconciliationLockName]
		)) as readonly { readonly locked?: boolean }[];
		if (lock?.locked !== true) return emptyResult();

		const [preserved] = (await manager.query(
			preserveRunnableRowsSql
		)) as readonly { readonly count: number | string }[];
		await backfillLegacyCheckpointContentDigests(manager);
		await manager.query(materializeCanonicalFrontierDependenciesSql);
		await manager.query(rebalanceRunnableFrontierSql, [
			historyArchivePerRootFrontier
		]);
		const [canonicalAdmission] = (await manager.query(
			admitCanonicalFrontierSql,
			[
				historyArchiveConsumerCount,
				historyArchiveMinimumWatermark,
				historyArchivePerHostConcurrency
			]
		)) as readonly { readonly count: number | string }[];
		const canonicalAdmittedObjects = Number(canonicalAdmission?.count ?? 0);
		const [counts] = (await manager.query(pressureSql, [
			historyArchiveMaximumWatermark + 1,
			historyArchiveThroughputSampleCap,
			historyArchiveThroughputWindowMinutes
		])) as readonly PressureRow[];
		const pressure = calculateHistoryArchivePlanningPressure({
			outstandingObjects: Number(counts?.outstandingObjects ?? 0),
			recentCompletions: Number(counts?.recentCompletions ?? 0)
		});

		if (pressure.availableSlots === 0) {
			await recordAdmissions(manager, canonicalAdmittedObjects);
			return {
				...pressure,
				admittedObjects: canonicalAdmittedObjects,
				cursorAdvances: 0,
				preservedObjects: Number(preserved?.count ?? 0)
			};
		}

		const proofAdmissionLimit = Math.min(
			historyArchiveConsumerCount,
			pressure.availableSlots
		);
		const [proofAdmission] = (await manager.query(
			admitProofCompletionReserveSql,
			[proofAdmissionLimit]
		)) as readonly { readonly count: number | string }[];
		const proofAdmittedObjects = Number(proofAdmission?.count ?? 0);
		const frontierSlots = Math.max(
			0,
			pressure.availableSlots - proofAdmittedObjects
		);

		let admission: AdmissionRow | undefined;
		if (frontierSlots > 0) {
			await manager.query(seedHistoryArchiveFrontierCursorsSql);
			[admission] = (await manager.query(historyArchiveObjectFrontierSql, [
				frontierSlots,
				historyArchivePerRootFrontier
			])) as readonly AdmissionRow[];
		}
		const admittedObjects =
			canonicalAdmittedObjects +
			proofAdmittedObjects +
			Number(admission?.admittedObjects ?? 0);
		await recordAdmissions(manager, admittedObjects);

		return {
			...pressure,
			admittedObjects,
			cursorAdvances: Number(admission?.cursorAdvances ?? 0),
			preservedObjects: Number(preserved?.count ?? 0)
		};
	});
}

async function recordAdmissions(
	manager: Repository<HistoryArchiveObject>['manager'],
	count: number
): Promise<void> {
	if (count === 0) return;
	await manager.query(
		`update "history_archive_reconciliation_state"
		 set "admittedRows" = "admittedRows" + $1::integer,
			"updatedAt" = now()
		 where name = 'execution-disposition'`,
		[count]
	);
}

function emptyResult(): HistoryArchiveObjectExecutionReconciliationResult {
	return {
		admittedObjects: 0,
		availableSlots: 0,
		cursorAdvances: 0,
		outstandingObjects: 0,
		preservedObjects: 0,
		recentCompletions: 0,
		watermark: 0
	};
}

const preserveRunnableRowsSql = `
	with preserved as (
		update "history_archive_object_queue"
		set "executionDisposition" = 'executable',
			"executionReason" = case
				when status = 'scanning' then 'in-flight-preserved'
				else 'retry-preserved'
			end,
			"executionDispositionAt" = now(),
			"dependencyReady" = true
		where status in ('scanning', 'failed')
			and "executionDisposition" is distinct from 'executable'
		returning id
	)
	select count(*)::integer as count from preserved
`;

const rebalanceRunnableFrontierSql = `
	with active_roots as materialized (
		select "archiveUrlIdentity", count(*)::integer as active_count
		from "history_archive_object_queue"
		where status = 'scanning'
		group by "archiveUrlIdentity"
	), ranked_pending as materialized (
		select candidate.id, candidate."archiveUrlIdentity",
			candidate."executionReason",
			row_number() over (
				partition by candidate."archiveUrlIdentity"
				order by
					case candidate."executionReason"
						when 'canonical-frontier-reserve' then 0
						when 'proof-completion-reserve' then 1
						else 2
					end,
					candidate."objectOrder",
					candidate."checkpointLedger" desc nulls last,
					candidate."objectKey",
					candidate.id
			) as root_rank
		from "history_archive_object_queue" candidate
		where candidate."executionDisposition" = 'executable'
			and candidate."dependencyReady" = true
			and candidate.status = 'pending'
	), demoted as (
		update "history_archive_object_queue" candidate
		set "executionDisposition" = 'deferred',
			"executionReason" = case
				when ranked."executionReason" = 'canonical-frontier-reserve'
					then 'canonical-frontier-waiting'
				when ranked."executionReason" = 'proof-completion-reserve'
					then 'proof-completion-waiting'
				else 'frontier-waiting'
			end,
			"executionDispositionAt" = now()
		from ranked_pending ranked
		left join active_roots active
			on active."archiveUrlIdentity" = ranked."archiveUrlIdentity"
		where candidate.id = ranked.id
			and ranked.root_rank > greatest(
				$1::integer - coalesce(active.active_count, 0),
				0
			)
		returning candidate.id
	)
	select count(*)::integer as count from demoted
`;

const pressureSql = `
	with outstanding as (
		select 1
		from (
			select id
			from "history_archive_object_queue"
			where status = 'scanning'
			union all
			select id
			from "history_archive_object_queue"
			where "executionDisposition" = 'executable'
				and "dependencyReady" = true
				and (
					status = 'pending'
					or (
						status = 'failed'
						and coalesce(
							"nextAttemptAt",
							"updatedAt" + interval '1 hour'
						) <= now()
					)
				)
		) runnable
		limit $1
	), recent_events as (
		select 1
		from "history_archive_object_event"
		where "eventType" = 'verified'
			and "createdAt" >= now() - make_interval(mins => $3::integer)
		limit $2
	)
	select
		(select count(*)::integer from outstanding) as "outstandingObjects",
		(select count(*)::integer from recent_events) as "recentCompletions"
`;

export const admitProofCompletionReserveSql = `
	with canonical_target_roots as materialized (
		select state."archiveUrlIdentity",
			runtime."checkpoint_ledger"::integer as checkpoint_ledger
		from "full_history_promotion_runtime" runtime
		join "history_archive_state_snapshot" state
			on state.status = 'available'
			and state."networkPassphrase" is not null
			and sha256(convert_to(state."networkPassphrase", 'UTF8')) =
				runtime."network_passphrase_hash"
		where runtime.state in ('promoting', 'waiting-for-proof')
			and runtime."checkpoint_ledger" is not null
	), proof_roots as materialized (
		select root."archiveUrlIdentity"
		from "history_archive_object_queue" root
		where root."objectType" = 'history-archive-state'
			and root."objectKey" = 'root'
	), proof_candidates as materialized (
		select newest."archiveUrlIdentity", newest."checkpointLedger"
		from proof_roots root
		join lateral (
			select proof."archiveUrlIdentity", proof."checkpointLedger"
			from "history_archive_checkpoint_proof" proof
			where proof."archiveUrlIdentity" = root."archiveUrlIdentity"
				and proof.status = 'not-evaluable'
				and proof."failureKind" = 'bucket-missing'
				and proof."requiredObjectsComplete" = true
				and proof."proofFactsComplete" = true
				and not exists (
					select 1
					from canonical_target_roots canonical
					where canonical."archiveUrlIdentity" =
						proof."archiveUrlIdentity"
						and canonical.checkpoint_ledger = proof."checkpointLedger"
				)
			order by proof."checkpointLedger" desc
			limit 1
		) newest on true
	), eligible as materialized (
		select candidate.id, candidate."archiveUrlIdentity",
			candidate."objectKey", max(proof."checkpointLedger") as checkpoint_ledger
		from proof_candidates proof
		join "history_archive_checkpoint_bucket_dependency" dependency
			on proof."archiveUrlIdentity" = dependency."archiveUrlIdentity"
			and proof."checkpointLedger" = dependency."checkpointLedger"
		join "history_archive_object_queue" candidate
			on candidate."archiveUrlIdentity" = dependency."archiveUrlIdentity"
			and candidate."bucketHash" = dependency."bucketHash"
		where candidate."objectType" = 'bucket'
			and (
				candidate."transitionEffectsRequiredAt" is null
				or candidate."transitionEffectsCompletedAt" is not null
			)
			and (
				(
					candidate.status = 'pending'
					and candidate."dependencyReady" = true
				)
				or (
					candidate.status = 'verified'
					and not coalesce((
						candidate."verificationFacts"#>>'{bucketObject,matched}' =
							'true'
						and lower(candidate."verificationFacts"#>>
							'{bucketObject,expectedBucketHash}') =
							dependency."bucketHash"
						and candidate."verificationFacts"#>>'{bucketObject,sourceUrl}' =
							candidate."objectUrl"
					), false)
				)
			)
			and candidate."executionReason" is distinct from
				'proof-completion-reserve'
			and not exists (
				select 1
				from "history_archive_object_queue" reserved
				where reserved."archiveUrlIdentity" = candidate."archiveUrlIdentity"
					and reserved."executionReason" = 'proof-completion-reserve'
					and reserved."executionDisposition" = 'executable'
					and reserved."dependencyReady" = true
					and reserved.status in ('pending', 'scanning')
			)
		group by candidate.id, candidate."archiveUrlIdentity",
			candidate."objectKey"
	), ranked as materialized (
		select eligible.id,
			row_number() over (
				partition by eligible."archiveUrlIdentity"
				order by eligible.checkpoint_ledger desc, eligible."objectKey"
			) as root_rank
		from eligible
	), selected as materialized (
		select id
		from ranked
		where root_rank = 1
		order by root_rank, id
		limit $1::integer
	), admitted as (
		update "history_archive_object_queue" candidate
		set status = 'pending',
			"executionDisposition" = 'executable',
			"executionReason" = 'proof-completion-reserve',
			"executionDispositionAt" = now(),
			"dependencyReady" = true,
			"nextAttemptAt" = null,
			"refreshAfter" = null,
			"workerStage" = null,
			"verifiedAt" = null
		from selected
		where candidate.id = selected.id
		returning candidate.id
	)
	select count(*)::integer as count from admitted
`;
