import type { EntityManager } from 'typeorm';
import { hasPostgresSqlState } from './PostgresError.js';

export interface HistoryArchiveReadyQueueSyncResult {
	readonly readyObjects: number;
	readonly removedObjects: number;
	readonly scheduledObjects: number;
}

const schedulableObjectSql = `
	candidate."executionDisposition" = 'executable'
	and candidate."dependencyReady" = true
	and (
		candidate."transitionEffectsRequiredAt" is null
		or candidate."transitionEffectsCompletedAt" is not null
	)
	and candidate.status in ('pending', 'failed')
`;

const readyAtSql = `case
	when candidate.status = 'failed' then coalesce(
		candidate."nextAttemptAt",
		candidate."updatedAt" + interval '1 hour'
	)
	else coalesce(candidate."nextAttemptAt", now())
end`;

const cleanupReadyObjectsSql = `
	with removed as (
		delete from "history_archive_object_ready" ready
		where not exists (
			select 1
			from "history_archive_object_queue" candidate
			where candidate."remoteId" = ready."objectRemoteId"
				and ${schedulableObjectSql}
		)
		returning ready."objectRemoteId"
	)
	select count(*)::integer as count from removed
`;

const refillReadyObjectsSql = `
	with roots as materialized (
		select root.id, root."archiveUrlIdentity", root."lastClaimedAt"
		from "history_archive_object_queue" root
		where root."objectType" = 'history-archive-state'
			and root."objectKey" = 'root'
			and not exists (
				select 1
				from "history_archive_object_host_throttle" throttle
				where throttle."hostIdentity" = root."hostIdentity"
					and throttle."blockedUntil" > now()
			)
			and not exists (
				select 1
				from "history_archive_object_claim_slot" slot
				join "history_archive_object_queue" active
					on active."remoteId" = slot."objectRemoteId"
					and active.status = 'scanning'
				where active."archiveUrlIdentity" = root."archiveUrlIdentity"
			)
	), candidates as materialized (
		select root.id as root_id, root."lastClaimedAt",
			root."archiveUrlIdentity", candidate."remoteId",
			case candidate."executionReason"
				when 'canonical-frontier-reserve' then 0
				when 'proof-completion-reserve' then 1
				else 2
			end::smallint as priority,
			${readyAtSql} as "availableAt"
		from roots root
		join lateral (
			select candidate."remoteId", candidate."executionReason",
				candidate.status, candidate."nextAttemptAt", candidate."updatedAt",
				candidate."lastClaimedAt",
				candidate."objectOrder", candidate."checkpointLedger",
				candidate."objectKey", candidate.id
			from "history_archive_object_queue" candidate
			where candidate."archiveUrlIdentity" = root."archiveUrlIdentity"
				and ${schedulableObjectSql}
			order by
				(${readyAtSql}) > now(),
				case candidate."executionReason"
					when 'canonical-frontier-reserve' then 0
					when 'proof-completion-reserve' then 1
					else 2
				end,
				candidate."lastClaimedAt" asc nulls first,
				candidate."objectOrder",
				candidate."checkpointLedger" desc nulls last,
				candidate."objectKey",
				candidate.id
			limit 1
		) candidate on true
	), selected as materialized (
		select "archiveUrlIdentity", "remoteId", priority, "availableAt"
		from candidates
		order by priority, "lastClaimedAt" asc nulls first, root_id
		limit $1::integer
	), inserted as (
		insert into "history_archive_object_ready" as stored (
			"objectRemoteId", "archiveUrlIdentity", priority, "availableAt",
			"createdAt", "updatedAt"
		)
		select "remoteId", "archiveUrlIdentity", priority, "availableAt",
			now(), now()
		from selected
		on conflict ("archiveUrlIdentity") do update
		set "objectRemoteId" = excluded."objectRemoteId",
			priority = excluded.priority,
			"availableAt" = excluded."availableAt",
			"updatedAt" = now()
		where stored."dispatchToken" is null
			and (
				stored."objectRemoteId" is distinct from excluded."objectRemoteId"
				or stored.priority is distinct from excluded.priority
				or stored."availableAt" is distinct from excluded."availableAt"
			)
		returning "objectRemoteId"
	)
	select count(*)::integer as count from inserted
`;

const readyObjectCountSql = `
	select count(*)::integer as count
	from "history_archive_object_ready"
`;

const bootstrapLockSql = `
	select pg_try_advisory_xact_lock(
		hashtext('history_archive_object_ready_bootstrap')
	) as locked,
	exists (
		select 1
		from "history_archive_object_claim_slot" slot
		where slot.slot < $1::integer
			and slot."objectRemoteId" is null
		limit 1
	) as "hasFreeSlot"
`;

export async function synchronizeHistoryArchiveReadyQueue(
	manager: EntityManager,
	limit: number
): Promise<HistoryArchiveReadyQueueSyncResult> {
	const boundedLimit = normalizeLimit(limit);
	const [removed] = (await manager.query(
		cleanupReadyObjectsSql
	)) as readonly CountRow[];
	const [scheduled] = (await manager.query(refillReadyObjectsSql, [
		boundedLimit
	])) as readonly CountRow[];
	const [ready] = (await manager.query(
		readyObjectCountSql
	)) as readonly CountRow[];

	return {
		readyObjects: toCount(ready?.count),
		removedObjects: toCount(removed?.count),
		scheduledObjects: toCount(scheduled?.count)
	};
}

export async function enqueueHistoryArchiveReadyObjects(
	manager: EntityManager,
	remoteIds: readonly string[]
): Promise<number> {
	if (remoteIds.length === 0) return 0;
	return await enqueueReadyRoots(manager, [...new Set(remoteIds)], []);
}

export async function enqueueHistoryArchiveReadyArchives(
	manager: EntityManager,
	archiveUrlIdentities: readonly string[]
): Promise<number> {
	if (archiveUrlIdentities.length === 0) return 0;
	return await enqueueReadyRoots(
		manager,
		[],
		[...new Set(archiveUrlIdentities)]
	);
}

export async function completeHistoryArchiveBrokerDelivery(
	manager: EntityManager,
	remoteId: string,
	executionId: string
): Promise<boolean> {
	const removed = (await manager.query(
		`delete from "history_archive_object_ready"
		 where "objectRemoteId" = $1::uuid
		   and "dispatchToken" = $2::uuid
		 returning "objectRemoteId"`,
		[remoteId, executionId]
	)) as readonly unknown[];
	if (removed.length === 0) return false;
	await enqueueHistoryArchiveReadyObjects(manager, [remoteId]);
	return true;
}

export async function bootstrapHistoryArchiveReadyQueueIfEmpty(
	manager: EntityManager,
	limit: number
): Promise<number> {
	try {
		return await manager.transaction(async (transaction) => {
			const boundedLimit = normalizeLimit(limit);
			await transaction.query(`
				set local lock_timeout = '250ms';
				set local statement_timeout = '2s';
				set local jit = off
			`);
			const [guard] = (await transaction.query(
				bootstrapLockSql,
				[boundedLimit]
			)) as readonly BootstrapGuardRow[];
			if (guard?.locked !== true || guard.hasFreeSlot !== true) return 0;
			const [scheduled] = (await transaction.query(refillReadyObjectsSql, [
				boundedLimit
			])) as readonly CountRow[];
			return toCount(scheduled?.count);
		});
	} catch (error) {
		if (
			hasPostgresSqlState(error, '55P03') ||
			hasPostgresSqlState(error, '57014')
		) {
			return 0;
		}
		throw error;
	}
}

async function enqueueReadyRoots(
	manager: EntityManager,
	remoteIds: readonly string[],
	archiveUrlIdentities: readonly string[]
): Promise<number> {
	const [row] = (await manager.query(enqueueReadyObjectsSql, [
		remoteIds,
		archiveUrlIdentities
	])) as readonly CountRow[];
	return toCount(row?.count);
}

const enqueueReadyObjectsSql = `
	with roots as materialized (
		select source."archiveUrlIdentity"
		from "history_archive_object_queue" source
		where source."remoteId" = any($1::uuid[])
		union
		select requested."archiveUrlIdentity"
		from unnest($2::text[]) requested("archiveUrlIdentity")
	), candidates as materialized (
		select root."archiveUrlIdentity", candidate."remoteId",
			case candidate."executionReason"
				when 'canonical-frontier-reserve' then 0
				when 'proof-completion-reserve' then 1
				else 2
			end::smallint as priority,
			${readyAtSql} as "availableAt"
		from roots root
		join lateral (
			select candidate.*
			from "history_archive_object_queue" candidate
			where candidate."archiveUrlIdentity" = root."archiveUrlIdentity"
				and ${schedulableObjectSql}
			order by
				(${readyAtSql}) > now(),
				case candidate."executionReason"
					when 'canonical-frontier-reserve' then 0
					when 'proof-completion-reserve' then 1
					else 2
				end,
				candidate."lastClaimedAt" asc nulls first,
				candidate."objectOrder",
				candidate."checkpointLedger" desc nulls last,
				candidate."objectKey",
				candidate.id
			limit 1
		) candidate on true
	), inserted as (
		insert into "history_archive_object_ready" as stored (
			"objectRemoteId", "archiveUrlIdentity", priority, "availableAt",
			"createdAt", "updatedAt"
		)
		select "remoteId", "archiveUrlIdentity", priority, "availableAt",
			now(), now()
		from candidates
		on conflict ("archiveUrlIdentity") do update
		set "objectRemoteId" = excluded."objectRemoteId",
			priority = excluded.priority,
			"availableAt" = excluded."availableAt",
			"updatedAt" = now()
		where stored."dispatchToken" is null
			and (
				stored."objectRemoteId" is distinct from excluded."objectRemoteId"
				or stored.priority is distinct from excluded.priority
				or stored."availableAt" is distinct from excluded."availableAt"
			)
		returning "objectRemoteId"
	)
	select count(*)::integer as count from inserted
`;

export const historyArchiveOutstandingReadyCountCtesSql = `
	active as (
		select count(*)::integer as count
		from "history_archive_object_claim_slot" slot
		where slot."objectRemoteId" is not null
	), ready as (
		select count(*)::integer as count
		from "history_archive_object_ready"
		where "availableAt" <= now()
	)
`;

export const historyArchiveReadyPressureSql = `
	with ${historyArchiveOutstandingReadyCountCtesSql}, recent_events as (
		select 1
		from "history_archive_object_event"
		where "eventType" = 'verified'
			and "createdAt" >= now() - make_interval(mins => $2::integer)
		limit $1::integer
	)
	select
		(active.count + ready.count)::integer as "outstandingObjects",
		(select count(*)::integer from recent_events) as "recentCompletions"
	from active, ready
`;

export const historyArchiveReadyRootActivityCtesSql = `
	active_objects as materialized (
		select object."archiveUrlIdentity"
		from "history_archive_object_claim_slot" slot
		join "history_archive_object_queue" object
			on object."remoteId" = slot."objectRemoteId"
			and object.status = 'scanning'
		union all
		select ready."archiveUrlIdentity"
		from "history_archive_object_ready" ready
	), active_by_root as materialized (
		select "archiveUrlIdentity", count(*)::integer as active_count
		from active_objects
		group by "archiveUrlIdentity"
	)
`;

interface CountRow {
	readonly count?: number | string;
}

interface BootstrapGuardRow {
	readonly hasFreeSlot?: boolean;
	readonly locked?: boolean;
}

function normalizeLimit(limit: number): number {
	if (!Number.isSafeInteger(limit) || limit < 1) return 24;
	return Math.min(limit, 4_096);
}

function toCount(value: number | string | undefined): number {
	const count = Number(value ?? 0);
	return Number.isSafeInteger(count) && count >= 0 ? count : 0;
}
