import type { Repository } from 'typeorm';
import type { HistoryArchiveObject } from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveObject.js';
import type { HistoryArchiveObjectExecutionReconciliationResult } from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveObjectRepository.js';
import { getHistoryArchiveBrokerMaximumPriority } from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveBrokerPriority.js';
import {
	calculateHistoryArchivePlanningPressure,
	historyArchiveCanonicalReserveCount,
	historyArchiveConsumerCount,
	historyArchiveMaximumWatermark,
	historyArchivePerHostConcurrency,
	historyArchivePerRootFrontier,
	historyArchiveThroughputSampleCap,
	historyArchiveThroughputWindowMinutes
} from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveObjectPlanningPolicy.js';
import {
	buildAdmitCanonicalFrontierSql,
	canonicalRuntimeTargetCtes,
	materializeCanonicalFrontierDependenciesSql
} from './HistoryArchiveCanonicalFrontierSql.js';
import { backfillLegacyCheckpointContentDigests } from './HistoryArchiveLegacyCheckpointDigestBackfill.js';
import { refreshOneStaleCanonicalCheckpointProof } from './HistoryArchiveCheckpointProofVersionRefresh.js';
import {
	historyArchiveObjectFrontierSql,
	seedHistoryArchiveFrontierCursorsSql
} from './HistoryArchiveObjectFrontierSql.js';
import {
	buildHistoryArchiveReadyPressureSql,
	synchronizeHistoryArchiveReadyQueue
} from './HistoryArchiveObjectReadyQueue.js';
import { hasPostgresSqlState } from './PostgresError.js';

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
	repository: Repository<HistoryArchiveObject>,
	options: { readonly admitGenericObjects?: boolean } = {}
): Promise<HistoryArchiveObjectExecutionReconciliationResult> {
	return await repository.manager.transaction(async (manager) => {
		const maximumPriority = getHistoryArchiveBrokerMaximumPriority();
		await manager.query(`set local lock_timeout = '500ms'`);
		await manager.query(`set local statement_timeout = '30s'`);
		await manager.query(`set local jit = off`);
		const [lock] = (await manager.query(
			'select pg_try_advisory_xact_lock(hashtext($1)) as locked',
			[reconciliationLockName]
		)) as readonly { readonly locked?: boolean }[];
		if (lock?.locked !== true) return emptyResult();

		await backfillLegacyCheckpointContentDigests(manager);
		await refreshOneStaleCanonicalCheckpointProof(manager);
		await manager.query(materializeCanonicalFrontierDependenciesSql);
		const [canonicalAdmission] = (await manager.query(
			buildAdmitCanonicalFrontierSql(maximumPriority),
			[historyArchiveCanonicalReserveCount, historyArchivePerHostConcurrency]
		)) as readonly { readonly count: number | string }[];
		const canonicalAdmittedObjects = Number(canonicalAdmission?.count ?? 0);
		const readyState = await synchronizeHistoryArchiveReadyQueue(
			manager,
			historyArchiveMaximumWatermark
		);
		const [counts] = (await manager.query(
			buildHistoryArchiveReadyPressureSql(maximumPriority),
			[historyArchiveThroughputSampleCap, historyArchiveThroughputWindowMinutes]
		)) as readonly PressureRow[];
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
				preservedObjects: readyState.readyObjects
			};
		}

		let proofAdmittedObjects = 0;
		if (maximumPriority >= 1) {
			const proofAdmissionLimit = Math.min(
				historyArchiveConsumerCount,
				pressure.availableSlots
			);
			const [proofAdmission] = (await manager.query(
				admitProofCompletionReserveSql,
				[proofAdmissionLimit]
			)) as readonly { readonly count: number | string }[];
			proofAdmittedObjects = Number(proofAdmission?.count ?? 0);
		}
		const frontierSlots = Math.max(
			0,
			pressure.availableSlots - proofAdmittedObjects
		);

		let admission: AdmissionRow | undefined;
		if (
			maximumPriority >= 2 &&
			frontierSlots > 0 &&
			options.admitGenericObjects !== false
		) {
			admission = await admitGenericHistoryArchiveFrontier(
				manager,
				frontierSlots
			);
		}
		const admittedObjects =
			canonicalAdmittedObjects +
			proofAdmittedObjects +
			Number(admission?.admittedObjects ?? 0);
		await synchronizeHistoryArchiveReadyQueue(
			manager,
			historyArchiveMaximumWatermark
		);
		await recordAdmissions(manager, admittedObjects);

		return {
			...pressure,
			admittedObjects,
			cursorAdvances: Number(admission?.cursorAdvances ?? 0),
			preservedObjects: readyState.readyObjects
		};
	});
}

const genericFrontierSavepoint = 'history_archive_generic_frontier';

export async function admitGenericHistoryArchiveFrontier(
	manager: Repository<HistoryArchiveObject>['manager'],
	frontierSlots: number
): Promise<AdmissionRow | undefined> {
	await manager.query(`savepoint ${genericFrontierSavepoint}`);
	try {
		await manager.query(`set local statement_timeout = '30s'`);
		await manager.query(seedHistoryArchiveFrontierCursorsSql);
		const [admission] = (await manager.query(historyArchiveObjectFrontierSql, [
			frontierSlots,
			historyArchivePerRootFrontier
		])) as readonly AdmissionRow[];
		await manager.query(`release savepoint ${genericFrontierSavepoint}`);
		await manager.query(`set local statement_timeout = '30s'`);
		return admission;
	} catch (error) {
		await manager.query(`rollback to savepoint ${genericFrontierSavepoint}`);
		await manager.query(`release savepoint ${genericFrontierSavepoint}`);
		if (
			hasPostgresSqlState(error, '57014') ||
			hasPostgresSqlState(error, '55P03')
		) {
			return undefined;
		}
		throw error;
	}
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

export const admitProofCompletionReserveSql = `
	with ${canonicalRuntimeTargetCtes}, canonical_target_roots as materialized (
		select state."archiveUrlIdentity",
			runtime.checkpoint_ledger
		from runtime_target runtime
		join "history_archive_state_snapshot" state
			on state.status = 'available'
			and state."networkPassphrase" is not null
			and sha256(convert_to(state."networkPassphrase", 'UTF8')) =
				runtime."network_passphrase_hash"
	), proof_roots as materialized (
		select root."archiveUrlIdentity"
		from "history_archive_object_queue" root
		where root."objectType" = 'history-archive-state'
			and root."objectKey" = 'root'
	), existing_reserve as materialized (
		select candidate.id, candidate.status,
			row_number() over (
				partition by candidate."archiveUrlIdentity"
				order by (candidate.status = 'scanning') desc,
					candidate."lastClaimedAt" desc nulls last,
					candidate.id
			) as root_rank
		from "history_archive_object_queue" candidate
		where candidate."executionReason" = 'proof-completion-reserve'
			and candidate."executionDisposition" = 'executable'
			and candidate."dependencyReady" = true
			and candidate.status in ('pending', 'scanning')
	), demoted_excess_reserve as (
		update "history_archive_object_queue" candidate
		set "executionDisposition" = 'deferred',
			"executionReason" = 'proof-completion-waiting',
			"executionDispositionAt" = now()
		from existing_reserve reserved
		where candidate.id = reserved.id
			and reserved.root_rank > 1
			and reserved.status = 'pending'
			and not exists (
				select 1
				from "history_archive_object_ready" ready
				where ready."objectRemoteId" = candidate."remoteId"
					and ready."dispatchToken" is not null
			)
		returning candidate.id
	), proof_fact_candidates as materialized (
		select newest."archiveUrlIdentity", newest."checkpointLedger",
			newest."ledgerObjectRemoteId"
		from proof_roots root
		join lateral (
			select proof."archiveUrlIdentity", proof."checkpointLedger",
				proof."ledgerObjectRemoteId"
			from "history_archive_checkpoint_proof" proof
			where proof."archiveUrlIdentity" = root."archiveUrlIdentity"
				and proof.status = 'not-evaluable'
				and proof."failureKind" = 'proof-facts-incomplete'
				and proof."requiredObjectsComplete" = true
				and coalesce(
					proof.details->>'ledgerHeaderHashesVerified',
					'false'
				) <> 'true'
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
	), proof_fact_eligible as materialized (
		select candidate.id, candidate."archiveUrlIdentity",
			candidate."objectKey", proof."checkpointLedger" as checkpoint_ledger,
			0 as priority
		from proof_fact_candidates proof
		join "history_archive_object_queue" candidate
			on candidate."remoteId" = proof."ledgerObjectRemoteId"
		where candidate."objectType" = 'ledger'
			and candidate.status = 'verified'
			and coalesce(
				candidate."verificationFacts"#>>
					'{ledgerCategory,headerHashesVerified}',
				'false'
			) <> 'true'
			and not exists (
				select 1
				from "history_archive_object_host_throttle" throttle
				where throttle."hostIdentity" = candidate."hostIdentity"
					and throttle."blockedUntil" > now()
			)
			and (
				candidate."transitionEffectsRequiredAt" is null
				or candidate."transitionEffectsCompletedAt" is not null
			)
			and candidate."executionReason" is distinct from
				'proof-completion-reserve'
			and not exists (
				select 1
				from "history_archive_object_ready" ready
				where ready."objectRemoteId" = candidate."remoteId"
					and ready."dispatchToken" is not null
			)
			and not exists (
				select 1
				from "history_archive_object_queue" reserved
				where reserved."archiveUrlIdentity" = candidate."archiveUrlIdentity"
					and reserved."executionReason" = 'proof-completion-reserve'
					and reserved."executionDisposition" = 'executable'
					and reserved."dependencyReady" = true
					and reserved.status in ('pending', 'scanning')
			)
	), bucket_eligible as materialized (
		select candidate.id, candidate."archiveUrlIdentity",
			candidate."objectKey", max(proof."checkpointLedger") as checkpoint_ledger,
			1 as priority
		from proof_candidates proof
		join "history_archive_checkpoint_bucket_dependency" dependency
			on proof."archiveUrlIdentity" = dependency."archiveUrlIdentity"
			and proof."checkpointLedger" = dependency."checkpointLedger"
		join "history_archive_object_queue" candidate
			on candidate."archiveUrlIdentity" = dependency."archiveUrlIdentity"
			and candidate."bucketHash" = dependency."bucketHash"
		where candidate."objectType" = 'bucket'
			and not exists (
				select 1
				from "history_archive_object_host_throttle" throttle
				where throttle."hostIdentity" = candidate."hostIdentity"
					and throttle."blockedUntil" > now()
			)
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
				from "history_archive_object_ready" ready
				where ready."objectRemoteId" = candidate."remoteId"
					and ready."dispatchToken" is not null
			)
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
	), eligible as materialized (
		select * from proof_fact_eligible
		union all
		select * from bucket_eligible
	), ranked as materialized (
		select eligible.id, eligible.priority,
			row_number() over (
				partition by eligible."archiveUrlIdentity"
				order by eligible.priority, eligible.checkpoint_ledger desc,
					eligible."objectKey"
			) as root_rank
		from eligible
	), selected as materialized (
		select id
		from ranked
		where root_rank = 1
		order by priority, id
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
