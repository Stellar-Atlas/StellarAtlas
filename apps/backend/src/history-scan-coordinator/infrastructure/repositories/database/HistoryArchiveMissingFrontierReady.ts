import type { EntityManager } from 'typeorm';
import { notifyHistoryArchiveReadyWork } from './HistoryArchiveObjectReadyQueue.js';
import { historyArchiveProofCompletionReserveMemberSql } from './HistoryArchiveProofCompletionReserveSql.js';

// Probe exact cursor keys and the indexed pending proof-reserve lane only.
// Existing ready reservations and all source/proof evidence remain untouched.
export const recoverMissingFrontierReadySql = `
 with checkpoint_candidates as materialized (
  select object."remoteId", object."archiveUrlIdentity",
   coalesce(object."nextAttemptAt", now()) as available_at
  from "history_archive_checkpoint_scan_cursor" cursor
  join "history_archive_object_queue" object
   on object."archiveUrlIdentity" = cursor."archiveUrlIdentity"
   and object."objectType" = 'checkpoint-state'
   and object."objectKey" = 'checkpoint-state:' ||
    lpad(to_hex(cursor."nextHistoricalCheckpointLedger" - 64), 8, '0')
   and object."checkpointLedger" = cursor."nextHistoricalCheckpointLedger" - 64
  where cursor."nextHistoricalCheckpointLedger" >= 127
   and object.status = 'pending'
   and object."dependencyReady" = true
   and object."executionDisposition" = 'executable'
   and (object."transitionEffectsRequiredAt" is null
    or object."transitionEffectsCompletedAt" is not null)
   and ($2::uuid[] is null or object."remoteId" = any($2::uuid[]))
   and not exists (
    select 1 from "history_archive_object_ready" ready
    where ready."objectRemoteId" = object."remoteId"
   )
  order by object."remoteId"
  limit $1::integer
 ), proof_reserve_candidates as materialized (
  select distinct on (object."archiveUrlIdentity")
   object."remoteId", object."archiveUrlIdentity",
   coalesce(object."nextAttemptAt", now()) as available_at
  from "history_archive_object_queue" object
  where object."executionReason" = 'proof-completion-reserve'
   and object."executionDisposition" = 'executable'
   and object."dependencyReady" = true
   and object.status = 'pending'
   and object."objectType" = 'ledger'
   and (object."transitionEffectsRequiredAt" is null
    or object."transitionEffectsCompletedAt" is not null)
   and ($2::uuid[] is null or object."remoteId" = any($2::uuid[]))
   and ${historyArchiveProofCompletionReserveMemberSql('object')}
   and not exists (
    select 1 from "history_archive_object_ready" ready
    where ready."objectRemoteId" = object."remoteId"
   )
  order by object."archiveUrlIdentity", object."checkpointLedger", object."remoteId"
 ), candidates as materialized (
  select "remoteId", "archiveUrlIdentity", available_at, 2 as priority
  from checkpoint_candidates
  union all
  select "remoteId", "archiveUrlIdentity", available_at, 1 as priority
  from proof_reserve_candidates
  order by priority, "remoteId"
  limit $1::integer
 ), recovered as (
  insert into "history_archive_object_ready" (
   "objectRemoteId", "archiveUrlIdentity", priority,
   "availableAt", "createdAt", "updatedAt"
  )
  select "remoteId", "archiveUrlIdentity", priority, available_at, now(), now()
  from candidates
  order by "remoteId"
  on conflict ("objectRemoteId") do nothing
  returning "objectRemoteId"
 )
 select count(*)::integer as count from recovered
`;

// Also supports an exact-ID operational repair; this does not retry failed files.
export async function recoverMissingFrontierReady(
	manager: EntityManager,
	limit: number,
	remoteIds: readonly string[] | null = null
): Promise<number> {
	if (!Number.isSafeInteger(limit) || limit < 1 || remoteIds?.length === 0)
		return 0;
	const [result] = (await manager.query(recoverMissingFrontierReadySql, [
		Math.min(limit, 4096),
		remoteIds === null ? null : [...new Set(remoteIds)]
	])) as readonly { readonly count: number }[];
	const count = result?.count ?? 0;
	if (count > 0) await notifyHistoryArchiveReadyWork(manager);
	return count;
}
