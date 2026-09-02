import type { EntityManager } from 'typeorm';
import { historyArchiveSequentialPrefetchDepth } from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveObjectPlanningPolicy.js';
import {
	historyArchiveCanonicalFirstAdmissionSql,
	historyArchiveCanonicalFirstScopeCteSql
} from './HistoryArchiveCanonicalFirst.js';
import { notifyHistoryArchiveReadyWork } from './HistoryArchiveObjectReadyQueue.js';

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
		[archiveUrlIdentity, historyArchiveSequentialPrefetchDepth]
	)) as readonly {
		readonly activated: number | string;
		readonly ready: number | string;
	}[];
	return {
		activated: Number(result?.activated ?? 0),
		ready: Number(result?.ready ?? 0)
	};
}

const orderedCheckpointPrefetchSql = `
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
                on conflict ("archiveUrlIdentity", "objectType", "objectKey")
                        do update
                        set "archiveUrl" = excluded."archiveUrl",
                                "hostIdentity" = excluded."hostIdentity",
                                "objectUrl" = excluded."objectUrl",
                                "dependencyReady" = true,
                                "executionDisposition" = 'executable',
                                "executionReason" = 'ordered-prefetch',
                                "executionDispositionAt" = now(),
                                "updatedAt" = now()
                        where "history_archive_object_queue".status = 'pending'
                                and (
                                        "history_archive_object_queue"."dependencyReady"
                                                is distinct from true
                                        or "history_archive_object_queue"."executionDisposition"
                                                is distinct from 'executable'
                                )
                returning "remoteId", "archiveUrlIdentity"
        ), ready as (
                insert into "history_archive_object_ready" (
                        "objectRemoteId", "archiveUrlIdentity", priority,
                        "availableAt", "createdAt", "updatedAt"
                )
                select inserted."remoteId", inserted."archiveUrlIdentity", 2,
                        now(), now(), now()
                from inserted
                on conflict ("objectRemoteId") do nothing
                returning "objectRemoteId"
        )
        select (select count(*) from inserted)::integer as planned,
                (select count(*) from ready)::integer as ready
`;

export const activateCurrentCheckpointDependenciesSql = `
	with ${historyArchiveCanonicalFirstScopeCteSql('$1::text')}, current_checkpoints as materialized (
		select cursor."archiveUrlIdentity",
			cursor."nextHistoricalCheckpointLedger" - 64 as "checkpointLedger"
		from "history_archive_checkpoint_scan_cursor" cursor
		where cursor."nextHistoricalCheckpointLedger" is not null
			and cursor."nextHistoricalCheckpointLedger" - 64 >= 63
			and ${historyArchiveCanonicalFirstAdmissionSql('cursor."archiveUrlIdentity"', '$1::text')}
	), candidates as materialized (
		select object.id, object."remoteId", object."archiveUrlIdentity"
		from current_checkpoints current
		join "history_archive_object_queue" object
			on object."archiveUrlIdentity" = current."archiveUrlIdentity"
		where object.status = 'pending'
			and (object."dependencyReady" = true
				or object."objectType" = 'bucket'
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
			and (object."executionDisposition" is null
				or object."executionDisposition" = 'deferred')
			and object."executionReason" is distinct from 'proof-completion-waiting'
			and object."executionReason" is distinct from 'canonical-frontier-waiting'
			and (object."transitionEffectsRequiredAt" is null
				or object."transitionEffectsCompletedAt" is not null)
			and ((object."objectType" <> 'bucket'
				and object."checkpointLedger" = current."checkpointLedger")
				or (object."objectType" = 'bucket' and exists (
					select 1
					from "history_archive_checkpoint_bucket_dependency" dependency
					where dependency."archiveUrlIdentity" = current."archiveUrlIdentity"
						and dependency."checkpointLedger" = current."checkpointLedger"
						and dependency."bucketHash" = object."bucketHash"
				)))
		order by current."archiveUrlIdentity", object."objectOrder",
			object."objectKey", object.id
		limit $2::integer
		for update of object skip locked
	), activated as (
		update "history_archive_object_queue" object
		set "dependencyReady" = true,
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
		on conflict ("objectRemoteId") do nothing
		returning "objectRemoteId"
	)
	select (select count(*) from activated)::integer as activated,
		(select count(*) from ready)::integer as ready
`;
