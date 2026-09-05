import type { EntityManager } from 'typeorm';
import {
	historyArchiveConsumerCount,
	historyArchiveSequentialPrefetchDepth
} from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveObjectPlanningPolicy.js';
import {
	historyArchiveCanonicalFirstAdmissionSql,
	historyArchiveCanonicalFirstScopeCteSql
} from './HistoryArchiveCanonicalFirst.js';
import { notifyHistoryArchiveReadyWork } from './HistoryArchiveObjectReadyQueue.js';
import { historyArchiveCheckpointBucketDependenciesSql } from './HistoryArchiveCheckpointDependencyReadSql.js';

export async function materializeOrderedCheckpointPrefetch(
	manager: EntityManager,
	archiveUrlIdentity: string | null = null
): Promise<number> {
	const [result] = (await manager.query(orderedCheckpointPrefetchSql, [
		historyArchiveSequentialPrefetchDepth,
		archiveUrlIdentity
	])) as readonly {
		readonly planned: number | string;
		readonly ready: number | string;
	}[];
	const activation = await activateCurrentCheckpointDependencies(
		manager,
		archiveUrlIdentity
	);
	if (Number(result?.ready ?? 0) + activation.ready > 0) {
		await notifyHistoryArchiveReadyWork(manager);
	}
	return Number(result?.planned ?? 0) + activation.activated;
}

export async function activateCurrentCheckpointDependencies(
	manager: EntityManager,
	archiveUrlIdentity: string | null = null
): Promise<{ readonly activated: number; readonly ready: number }> {
	const [result] = (await manager.query(
		activateCurrentCheckpointDependenciesSql,
		[
			archiveUrlIdentity,
			historyArchiveSequentialPrefetchDepth,
			historyArchiveConsumerCount
		]
	)) as readonly {
		readonly activated: number | string;
		readonly ready: number | string;
	}[];
	return {
		activated: Number(result?.activated ?? 0),
		ready: Number(result?.ready ?? 0)
	};
}

export const orderedCheckpointPrefetchSql = `
	with ${historyArchiveCanonicalFirstScopeCteSql('$2::text')}, available_roots as materialized (
                select state."archiveUrlIdentity", root."archiveUrl",
                        root."hostIdentity",
                        (
                                floor((state."currentLedger" + 1)::numeric / 64) * 64 - 1
                        )::integer as latest_checkpoint
                from "history_archive_state_snapshot" state
                join "history_archive_object_queue" root
                        on root."archiveUrlIdentity" = state."archiveUrlIdentity"
                        and root."objectType" = 'history-archive-state'
                        and root."objectKey" = 'root'
                        and root.status = 'verified'
                        and state."archiveUrlIdentity" =
                                regexp_replace(root."archiveUrl", '/+$', '')
                where state.status = 'available'
                        and state."currentLedger" >= 63
			and ${historyArchiveCanonicalFirstAdmissionSql('state."archiveUrlIdentity"', '$2::text')}
        ), candidates as materialized (
                select cursor."archiveUrlIdentity", root."archiveUrl",
                        root."hostIdentity", checkpoint.checkpoint_ledger
                from "history_archive_checkpoint_scan_cursor" cursor
                join available_roots root
                        on root."archiveUrlIdentity" =
                                cursor."archiveUrlIdentity"
                cross join lateral generate_series(
                        cursor."nextHistoricalCheckpointLedger" - 64,
                        least(
                                greatest(
                                        cursor."latestCheckpointLedger",
                                        root.latest_checkpoint
                                ),
                                cursor."nextHistoricalCheckpointLedger" - 64 +
                                        (($1::integer - 1) * 64)
                        ),
                        64
                ) checkpoint(checkpoint_ledger)
                where cursor."nextHistoricalCheckpointLedger" is not null
        ), source as materialized (
                select candidates.*,
                        lpad(to_hex(candidates.checkpoint_ledger), 8, '0') as checkpoint_hex
                from candidates
                where candidates.checkpoint_ledger >= 63
        ), inserted as (
                insert into "history_archive_object_queue" (
                        "remoteId", "archiveUrl", "archiveUrlIdentity", "hostIdentity",
                        "objectType", "objectKey", "objectOrder", "objectUrl", status,
                        "checkpointLedger", "dependencyReady",
                        "executionDisposition", "executionReason",
                        "executionDispositionAt"
                )
                select gen_random_uuid(), source."archiveUrl",
                        source."archiveUrlIdentity", source."hostIdentity",
                        'checkpoint-state',
                        'checkpoint-state:' || source.checkpoint_hex,
                        10,
                        rtrim(source."archiveUrl", '/') || '/history/' ||
                                substring(source.checkpoint_hex from 1 for 2) || '/' ||
                                substring(source.checkpoint_hex from 3 for 2) || '/' ||
                                substring(source.checkpoint_hex from 5 for 2) || '/' ||
                                'history-' || source.checkpoint_hex || '.json',
                        'pending', source.checkpoint_ledger, true,
                        'executable', 'ordered-prefetch', now()
                from source
                order by source."archiveUrlIdentity",
                        source.checkpoint_ledger
                on conflict ("archiveUrlIdentity", "objectType", "objectKey") do nothing
                returning "remoteId", "archiveUrlIdentity"
        ), ready as (
                insert into "history_archive_object_ready" (
                        "objectRemoteId", "archiveUrlIdentity", priority,
                        "availableAt", "createdAt", "updatedAt"
                )
                select inserted."remoteId", inserted."archiveUrlIdentity", 2,
                        now(), now(), now()
                from inserted
                order by inserted."remoteId"
                on conflict ("objectRemoteId") do nothing
                returning "objectRemoteId"
        )
        select (select count(*) from inserted)::integer as planned,
                (select count(*) from ready)::integer as ready
`;

export const activateCurrentCheckpointDependenciesSql = `
	with ${historyArchiveCanonicalFirstScopeCteSql('$1::text')}, current_checkpoints as materialized (
		select cursor."archiveUrlIdentity",
			checkpoint.checkpoint_ledger as "checkpointLedger"
		from "history_archive_checkpoint_scan_cursor" cursor
		cross join lateral generate_series(
			cursor."nextHistoricalCheckpointLedger" - 64,
			least(
				cursor."latestCheckpointLedger",
				cursor."nextHistoricalCheckpointLedger" - 64 +
					(($2::integer - 1) * 64)
			),
			64
		) checkpoint(checkpoint_ledger)
		where cursor."nextHistoricalCheckpointLedger" is not null
			and cursor."nextHistoricalCheckpointLedger" - 64 >= 63
			and ${historyArchiveCanonicalFirstAdmissionSql('cursor."archiveUrlIdentity"', '$1::text')}
	), candidate_keys as materialized (
		select object.id, current."checkpointLedger",
			(object.status = 'verified') as "needsReverification"
		from current_checkpoints current
		join "history_archive_object_queue" object
			on object."archiveUrlIdentity" = current."archiveUrlIdentity"
			and object."checkpointLedger" = current."checkpointLedger"
			and object."objectType" <> 'bucket'
		where (
			object.status = 'pending'
			or (
				object.status = 'verified'
				and object."objectType" = 'ledger'
				and coalesce(
					object."verificationFacts"#>>
						'{ledgerCategory,headerHashesVerified}',
					'false'
				) <> 'true'
				and exists (
					select 1
					from "history_archive_checkpoint_proof" proof
					where proof."archiveUrlIdentity" =
						object."archiveUrlIdentity"
						and proof."checkpointLedger" =
							current."checkpointLedger"
						and proof.status = 'not-evaluable'
						and proof."failureKind" = 'proof-facts-incomplete'
				)
			)
		)
			and (
				object."objectType" = 'checkpoint-state'
				or object."dependencyReady" = true
				or (object."objectType" <> 'checkpoint-state' and exists (
					select 1
					from "history_archive_object_queue" checkpoint_state
					where checkpoint_state."archiveUrlIdentity" =
						current."archiveUrlIdentity"
						and checkpoint_state."checkpointLedger" =
							current."checkpointLedger"
						and checkpoint_state."objectType" =
							'checkpoint-state'
						and checkpoint_state.status = 'verified'
				)))
			and (object.status = 'verified'
				or object."executionDisposition" is null
				or object."executionDisposition" = 'deferred')
			and (object."transitionEffectsRequiredAt" is null
				or object."transitionEffectsCompletedAt" is not null)
			and (object.status <> 'verified' or not exists (
				select 1
				from "history_archive_object_ready" ready
				where ready."objectRemoteId" = object."remoteId"
					and ready."dispatchToken" is not null
			))
		union all
		select object.id, current."checkpointLedger", false
		from current_checkpoints current
		cross join lateral (
			${historyArchiveCheckpointBucketDependenciesSql(
				'current."archiveUrlIdentity"',
				'current."checkpointLedger"'
			)}
		) dependency
		join "history_archive_object_queue" object
			on object."archiveUrlIdentity" = current."archiveUrlIdentity"
			and object."bucketHash" = dependency."bucketHash"
			and object."objectType" = 'bucket'
		where object.status = 'pending'
			and (object."executionDisposition" is null
				or object."executionDisposition" = 'deferred')
			and (object."transitionEffectsRequiredAt" is null
				or object."transitionEffectsCompletedAt" is not null)
	), candidate_ids as materialized (
		select candidate.id,
			min(candidate."checkpointLedger") as "checkpointLedger",
			bool_or(candidate."needsReverification") as "needsReverification"
		from candidate_keys candidate
		group by candidate.id
	), ranked_candidates as materialized (
		select object.id, object."remoteId", object."archiveUrlIdentity",
			candidate."needsReverification", candidate."checkpointLedger",
			object."objectOrder", object."objectKey",
			row_number() over (
				partition by object."archiveUrlIdentity"
				order by candidate."checkpointLedger", object."objectOrder",
					object."objectKey", object.id
			) as root_rank
		from candidate_ids candidate
		join "history_archive_object_queue" object
			on object.id = candidate.id
	), selected_candidates as materialized (
		select id, "remoteId", "archiveUrlIdentity",
			"needsReverification", "checkpointLedger",
			"objectOrder", "objectKey", root_rank
		from ranked_candidates
		order by root_rank, "archiveUrlIdentity", "checkpointLedger",
			"objectOrder", "objectKey", id
		limit $3::integer
	), candidates as materialized (
		select object.id, object."remoteId", object."archiveUrlIdentity",
			selected."needsReverification"
		from selected_candidates selected
		join "history_archive_object_queue" object
			on object.id = selected.id
		order by selected.root_rank, object."archiveUrlIdentity",
			selected."checkpointLedger",
			object."objectOrder", object."objectKey", object.id
		for update of object skip locked
	), activated as (
		update "history_archive_object_queue" object
		set status = case when candidate."needsReverification"
				then 'pending' else object.status end,
			"workerStage" = case when candidate."needsReverification"
				then null else object."workerStage" end,
			"verifiedAt" = case when candidate."needsReverification"
				then null else object."verifiedAt" end,
			"nextAttemptAt" = case when candidate."needsReverification"
				then null else object."nextAttemptAt" end,
			"refreshAfter" = case when candidate."needsReverification"
				then null else object."refreshAfter" end,
			"dependencyReady" = true,
			"executionDisposition" = 'executable',
			"executionReason" = 'ordered-current-checkpoint',
			"executionDispositionAt" = now(),
			"updatedAt" = now()
		from candidates candidate
		where object.id = candidate.id
		returning object."remoteId", object."archiveUrlIdentity"
	), ready as (
		insert into "history_archive_object_ready" (
			"objectRemoteId", "archiveUrlIdentity", priority,
			"availableAt", "createdAt", "updatedAt"
		)
		select activated."remoteId", activated."archiveUrlIdentity", 1,
			now(), now(), now()
		from activated
		order by activated."remoteId"
		on conflict ("objectRemoteId") do nothing
		returning "objectRemoteId"
	)
	select (select count(*) from activated)::integer as activated,
		(select count(*) from ready)::integer as ready
`;
