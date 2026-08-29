import type { EntityManager } from 'typeorm';
import { historyArchiveSequentialPrefetchDepth } from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveObjectPlanningPolicy.js';
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
	if (Number(result?.ready ?? 0) > 0) {
		await notifyHistoryArchiveReadyWork(manager);
	}
	return Number(result?.planned ?? 0);
}

const orderedCheckpointPrefetchSql = `
        with available_roots as materialized (
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
                        and ($2::text is null or
                                state."archiveUrlIdentity" = $2::text)
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
                        do nothing
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
