import type { DataSource, EntityManager } from 'typeorm';
import {
	historyArchiveConsumerCount,
	historyArchiveSequentialPrefetchDepth
} from '../../../domain/history-archive-object/HistoryArchiveObjectPlanningPolicy.js';
import { historyArchiveHostScanAllowedSql } from '../../../domain/history-archive-object/HistoryArchiveScanPolicy.js';
import {
	getHistoryArchiveCanonicalFirstRoot,
	historyArchiveCanonicalFirstAdmissionSql,
	historyArchiveCanonicalFirstScopeCteSql
} from './HistoryArchiveCanonicalFirst.js';
import { historyArchiveRootControlAllowedSql } from './HistoryArchiveRootFailureControl.js';
import { notifyHistoryArchiveReadyWork } from './HistoryArchiveObjectReadyQueue.js';
import { withBoundedArchiveBrokerMaintenance } from './BoundedArchiveBrokerMaintenance.js';
import { historyArchiveExecutionReconciliationLockName } from './HistoryArchiveObjectExecutionReconciler.js';

// Commit lookahead before legacy maintenance: an unrelated later timeout must
// not discard these bounded admissions. Reuse one configured worker-pool batch.
export async function prefetchAdjacentCheckpointStates(
	dataSource: DataSource,
	archiveUrlIdentity: string | null,
	reportDeferred?: (code: string) => void
): Promise<number> {
	if (process.env.HISTORY_ARCHIVE_ADJACENT_PREFETCH_ENABLED !== 'true')
		return 0;
	return withBoundedArchiveBrokerMaintenance(
		dataSource,
		async (manager) => {
			const [lock] = (await manager.query(
				'select pg_try_advisory_xact_lock(hashtext($1)) as locked',
				[historyArchiveExecutionReconciliationLockName]
			)) as readonly { readonly locked?: boolean }[];
			if (lock?.locked !== true) return 0;
			const result = await materializeAdjacentCheckpointStates(
				manager,
				archiveUrlIdentity === null ? null : [archiveUrlIdentity],
				historyArchiveConsumerCount
			);
			return result.ready;
		},
		0,
		reportDeferred
	);
}

/** Download lookahead only. The persisted open cursor anchors the finite window;
 * neither completed downloads nor repeated calls move that window. Existing
 * planner batch capacity bounds writes; the configured cohort bounds reads. */
export async function materializeAdjacentCheckpointStates(
	manager: EntityManager,
	archiveUrlIdentities: readonly string[] | null,
	planningBatchSize: number
): Promise<{ readonly planned: number; readonly ready: number }> {
	if (historyArchiveSequentialPrefetchDepth <= 1 || planningBatchSize < 1)
		return { planned: 0, ready: 0 };
	const [row] = (await manager.query(adjacentCheckpointPrefetchSql(), [
		archiveUrlIdentities,
		historyArchiveSequentialPrefetchDepth,
		Math.floor(planningBatchSize),
		getHistoryArchiveCanonicalFirstRoot()
	])) as readonly { readonly planned: number; readonly ready: number }[];
	const result = {
		planned: Number(row?.planned ?? 0),
		ready: Number(row?.ready ?? 0)
	};
	if (result.ready > 0) await notifyHistoryArchiveReadyWork(manager);
	return result;
}

export function adjacentCheckpointPrefetchSql(): string {
	return `with ${historyArchiveCanonicalFirstScopeCteSql('$4::text')}, roots as materialized (
		select cursor."archiveUrlIdentity",cursor."nextHistoricalCheckpointLedger"-64 as open_checkpoint,
			(floor((state."currentLedger"::bigint+1)::numeric/64)*64-1)::integer as head,
			root."archiveUrl",root."hostIdentity"
		from history_archive_checkpoint_scan_cursor cursor
		join history_archive_state_snapshot state using ("archiveUrlIdentity")
		join history_archive_object_queue root on root."archiveUrlIdentity"=cursor."archiveUrlIdentity"
			and root."objectType"='history-archive-state' and root."objectKey"='root'
		where cursor."nextHistoricalCheckpointLedger">=127 and state.status='available'
			and state."archiveUrlIdentity"=regexp_replace(root."archiveUrl", '/+$', '')
			and ($1::text[] is null or cursor."archiveUrlIdentity"=any($1::text[]))
			and ${historyArchiveHostScanAllowedSql('root')}
			and ${historyArchiveCanonicalFirstAdmissionSql('cursor."archiveUrlIdentity"', '$4::text')}
			and not exists (select 1 from history_archive_object_host_throttle throttle
				where throttle."hostIdentity"=root."hostIdentity" and throttle."blockedUntil">now())
		order by cursor."updatedAt",cursor."archiveUrlIdentity"
	), points as materialized (
		select root.*,position.ordinal,'checkpoint-state'::text as "objectType",
			(root.open_checkpoint+position.ordinal*64)::integer as "checkpointLedger",
			'checkpoint-state:'||lpad(to_hex(root.open_checkpoint+position.ordinal*64),8,'0') as object_key
		from roots root cross join lateral generate_series(1,
			least($2::integer-1,(root.head-root.open_checkpoint)/64)) position(ordinal)
	), missing as materialized (
		select point.*,object."remoteId" as existing_id
		from points point
		left join lateral (select queued.* from history_archive_object_queue queued
			where queued."archiveUrlIdentity"=point."archiveUrlIdentity"
				and queued."objectType"='checkpoint-state' and queued."objectKey"=point.object_key limit 1) object on true
		where ${historyArchiveRootControlAllowedSql('point')}
			and not exists (select 1 from history_archive_listing_gap gap
				where gap."archiveUrlIdentity"=point."archiveUrlIdentity" and gap."resolvedAt" is null
					and point."checkpointLedger" between gap."firstCheckpointLedger" and gap."lastCheckpointLedger")
			and not exists (select 1 from history_archive_checkpoint_proof proof
				where proof."archiveUrlIdentity"=point."archiveUrlIdentity"
					and proof."checkpointLedger"=point."checkpointLedger" and proof.status='verified')
			and (object."remoteId" is null or (object.status='pending' and object.attempts=0
				and (object."nextAttemptAt" is null or object."nextAttemptAt"<=now())
				and object."dependencyReady" and object."executionDisposition"='executable'
				and (object."transitionEffectsRequiredAt" is null or object."transitionEffectsCompletedAt" is not null)))
			and not exists (select 1 from history_archive_object_ready ready where ready."objectRemoteId"=object."remoteId")
		order by point.ordinal,point."archiveUrlIdentity" limit $3::integer
	), inserted as (
		insert into history_archive_object_queue (
			"remoteId","archiveUrl","archiveUrlIdentity","hostIdentity","objectType","objectKey","objectOrder",
			"objectUrl",status,"checkpointLedger","dependencyReady","executionDisposition","executionReason","executionDispositionAt")
		select gen_random_uuid(),point."archiveUrl",point."archiveUrlIdentity",point."hostIdentity",'checkpoint-state',
			point.object_key,10,rtrim(point."archiveUrl",'/')||'/history/'||
			substring(lpad(to_hex(point."checkpointLedger"),8,'0') from 1 for 2)||'/'||
			substring(lpad(to_hex(point."checkpointLedger"),8,'0') from 3 for 2)||'/'||
			substring(lpad(to_hex(point."checkpointLedger"),8,'0') from 5 for 2)||'/history-'||
			lpad(to_hex(point."checkpointLedger"),8,'0')||'.json','pending',point."checkpointLedger",true,
			'executable','planned-frontier',now()
		from missing point where point.existing_id is null
		order by point."archiveUrlIdentity",point."checkpointLedger"
		on conflict ("archiveUrlIdentity","objectType","objectKey") do nothing
		returning "remoteId","archiveUrlIdentity"
	), targets as materialized (
		select "remoteId","archiveUrlIdentity" from inserted
		union all select existing_id,"archiveUrlIdentity" from missing where existing_id is not null
	), admitted as (
		insert into history_archive_object_ready ("objectRemoteId","archiveUrlIdentity",priority,"availableAt","createdAt","updatedAt")
		select "remoteId","archiveUrlIdentity",2,now(),now(),now() from targets order by "remoteId"
		on conflict ("objectRemoteId") do nothing returning "objectRemoteId"
	) select (select count(*)::integer from inserted) as planned,
		(select count(*)::integer from admitted) as ready`;
}
