import type { EntityManager } from 'typeorm';
import {
	getHistoryArchiveBrokerMaximumPriority,
	type HistoryArchiveBrokerPriority
} from '../../../domain/history-archive-object/HistoryArchiveBrokerPriority.js';
import {
	canonicalRuntimeArchiveRootsCteSql,
	canonicalRuntimePriorityCtesSql,
	historyArchiveEffectivePrioritySql
} from './HistoryArchiveCanonicalRuntimePrioritySql.js';
import { hasPostgresSqlState } from './PostgresError.js';
import { historyArchiveObjectOpenSequentialCohortSql } from './HistoryArchiveSequentialChainSql.js';

export const historyArchiveExecutionReconciliationLockName =
	'history_archive_execution_reconciliation';
export const historyArchiveReadyNotificationChannel =
	'stellaratlas_history_archive_ready';

export async function notifyHistoryArchiveReadyWork(
	manager: EntityManager
): Promise<void> {
	await manager.query('select pg_notify($1::text, $2::text)', [
		historyArchiveReadyNotificationChannel,
		'ready'
	]);
}

export interface HistoryArchiveReadyQueueSyncResult {
	readonly readyObjects: number;
	readonly removedObjects: number;
	readonly scheduledObjects: number;
}

export function historyArchiveCheckpointNotFoundCooldownSql(
	_objectAlias: string
): string {
	return 'true';
}

export function historyArchiveSchedulableObjectSql(
	objectAlias: string
): string {
	return `
	${objectAlias}."executionDisposition" = 'executable'
	and ${objectAlias}."dependencyReady" = true
	and (
		${objectAlias}."transitionEffectsRequiredAt" is null
		or ${objectAlias}."transitionEffectsCompletedAt" is not null
	)
	and ${objectAlias}.status in ('pending', 'failed')
        and ${historyArchiveObjectOpenSequentialCohortSql(objectAlias)}
`;
}

const schedulableObjectSql = historyArchiveSchedulableObjectSql('candidate');

const readyAtSql = `case
	when candidate.status = 'failed' then coalesce(
		candidate."nextAttemptAt",
		candidate."updatedAt" + interval '1 hour'
	)
	else coalesce(candidate."nextAttemptAt", now())
end`;

const cleanupReadyObjectsSql = `
        with candidates as materialized (
                select ready.ctid
                from "history_archive_object_ready" ready
                where (
                        (
                                ready."dispatchToken" is null
                                and ready."publishedAt" is null
                                and not exists (
                                        select 1
                                        from "history_archive_object_queue" candidate
                                        where candidate."remoteId" = ready."objectRemoteId"
                                                and ${schedulableObjectSql}
                                )
                        )
                        or exists (
                                select 1
                                from "history_archive_object_queue" completed
                                where completed."remoteId" = ready."objectRemoteId"
                                        and ready."claimAttempt" is not null
                                        and completed.attempts >= ready."claimAttempt"
                                        and completed.status in ('verified', 'failed')
                        )
                )
                order by ready."objectRemoteId"
                for update of ready skip locked
                limit 4096
        ), removed as (
                delete from "history_archive_object_ready" ready
                using candidates
                where ready.ctid = candidates.ctid
                returning ready."objectRemoteId"
        )
        select count(*)::integer as count from removed
`;

const refillReadyObjectsSql = `
	with ${canonicalRuntimePriorityCtesSql}, roots as materialized (
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
			and ${historyArchiveCheckpointNotFoundCooldownSql('root')}
	), candidates as materialized (
		select root.id as root_id, root."lastClaimedAt",
			root."archiveUrlIdentity", candidate."remoteId",
			${historyArchiveEffectivePrioritySql('candidate')} as priority,
			${readyAtSql} as "availableAt"
		from roots root
		join lateral (
			select candidate."remoteId", candidate."executionReason",
				candidate.status, candidate."nextAttemptAt", candidate."updatedAt",
				candidate."lastClaimedAt",
				candidate."objectOrder", candidate."checkpointLedger",
				candidate."objectKey", candidate."objectType",
				candidate."bucketHash", candidate."archiveUrlIdentity",
				candidate.id
			from "history_archive_object_queue" candidate
			where candidate."archiveUrlIdentity" = root."archiveUrlIdentity"
				and ${schedulableObjectSql}
			order by
				(${readyAtSql}) > now(),
				${historyArchiveEffectivePrioritySql('candidate')},
				candidate."lastClaimedAt" asc nulls first,
				candidate."objectOrder",
				candidate."checkpointLedger" desc nulls last,
				candidate."objectKey",
				candidate.id
			limit $1::integer
		) candidate on true
	), selected as materialized (
		select "archiveUrlIdentity", "remoteId", priority, "availableAt"
		from candidates
		order by priority, "lastClaimedAt" asc nulls first, root_id
		limit $1::integer
	), locked_existing as materialized (
		select stored."objectRemoteId"
		from selected
		join "history_archive_object_ready" stored
			on stored."objectRemoteId" = selected."remoteId"
		order by stored."objectRemoteId"
		for update of stored
	), upserted as (
		insert into "history_archive_object_ready" as stored (
			"objectRemoteId", "archiveUrlIdentity", priority, "availableAt",
			"createdAt", "updatedAt"
		)
		select selected."remoteId", selected."archiveUrlIdentity",
			selected.priority, selected."availableAt",
			now(), now()
		from selected
		left join locked_existing
			on locked_existing."objectRemoteId" = selected."remoteId"
		order by selected."remoteId"
		on conflict ("objectRemoteId") do update
		set priority = excluded.priority,
			"availableAt" = excluded."availableAt",
			"updatedAt" = now()
		where stored."dispatchToken" is null
			and stored."publishedAt" is null
			and (
				stored.priority is distinct from excluded.priority
				or stored."availableAt" is distinct from
					excluded."availableAt"
			)
		returning stored."objectRemoteId"
	)
	select count(*)::integer as count from upserted
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

async function tryTakeHistoryArchiveReadyWriterLock(
	manager: EntityManager
): Promise<boolean> {
	const [lock] = (await manager.query(
		'select pg_try_advisory_xact_lock(hashtext($1)) as locked',
		[historyArchiveExecutionReconciliationLockName]
	)) as readonly { readonly locked?: boolean }[];
	return lock?.locked === true;
}

export async function synchronizeHistoryArchiveReadyQueue(
	manager: EntityManager,
	limit: number
): Promise<HistoryArchiveReadyQueueSyncResult> {
	if (manager.queryRunner?.isTransactionActive !== true) {
		return await manager.transaction(
			async (transaction) =>
				await synchronizeHistoryArchiveReadyQueue(transaction, limit)
		);
	}
	if (!(await tryTakeHistoryArchiveReadyWriterLock(manager))) {
		return { readyObjects: 0, removedObjects: 0, scheduledObjects: 0 };
	}
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

	const result = {
		readyObjects: toCount(ready?.count),
		removedObjects: toCount(removed?.count),
		scheduledObjects: toCount(scheduled?.count)
	};
	if (result.scheduledObjects > 0) await notifyHistoryArchiveReadyWork(manager);
	return result;
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
			if (!(await tryTakeHistoryArchiveReadyWriterLock(transaction))) return 0;
			const [guard] = (await transaction.query(bootstrapLockSql, [
				boundedLimit
			])) as readonly BootstrapGuardRow[];
			if (guard?.locked !== true || guard.hasFreeSlot !== true) return 0;
			const [scheduled] = (await transaction.query(refillReadyObjectsSql, [
				boundedLimit
			])) as readonly CountRow[];
			const scheduledCount = toCount(scheduled?.count);
			if (scheduledCount > 0) await notifyHistoryArchiveReadyWork(transaction);
			return scheduledCount;
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

export function buildHistoryArchiveOutstandingReadyCountCtesSql(
	maximumPriority: HistoryArchiveBrokerPriority = getHistoryArchiveBrokerMaximumPriority(),
	runtimeTargetCtesAvailable = false
): string {
	return `
	${runtimeTargetCtesAvailable ? canonicalRuntimeArchiveRootsCteSql : canonicalRuntimePriorityCtesSql},
	active as (
		select count(*)::integer as count
		from "history_archive_object_claim_slot" slot
		where slot."objectRemoteId" is not null
	), ready as (
		select count(*)::integer as count
		from "history_archive_object_ready" queued
		join "history_archive_object_queue" object
			on object."remoteId" = queued."objectRemoteId"
		where queued."publishedAt" is not null
			or queued."dispatchToken" is not null
			or (
				queued."availableAt" <= now()
				and (
					${historyArchiveCheckpointNotFoundCooldownSql('object')}
					and ${historyArchiveSchedulableObjectSql('object')}
					and ${historyArchiveEffectivePrioritySql('object')} <=
						${maximumPriority}::smallint
					and not exists (
						select 1
						from "history_archive_object_host_throttle" throttle
						where throttle."hostIdentity" = object."hostIdentity"
							and throttle."blockedUntil" > now()
					)
				)
			)
	)
`;
}

export const historyArchiveOutstandingReadyCountCtesSql =
	buildHistoryArchiveOutstandingReadyCountCtesSql();

export function buildHistoryArchiveReadyPressureSql(
	maximumPriority: HistoryArchiveBrokerPriority = getHistoryArchiveBrokerMaximumPriority()
): string {
	return `
	with ${buildHistoryArchiveOutstandingReadyCountCtesSql(maximumPriority)}, recent_events as (
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
}

export const historyArchiveReadyPressureSql =
	buildHistoryArchiveReadyPressureSql();

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

export async function removeCompletedHistoryArchiveBrokerReadyRow(
	manager: EntityManager,
	remoteId: string,
	executionId: string,
	claimAttempt: number
): Promise<void> {
	await manager.query(
		`delete from "history_archive_object_ready"
		 where "objectRemoteId" = $1::uuid
		   and "dispatchToken" = $2::uuid
		   and "claimAttempt" = $3::integer`,
		[remoteId, executionId, claimAttempt]
	);
}

export async function requeueFailedHistoryArchiveBrokerReadyRow(
	manager: EntityManager,
	remoteId: string,
	executionId: string,
	claimAttempt: number,
	availableAt: Date | null
): Promise<void> {
	await manager.query(
		`update "history_archive_object_ready"
                 set "dispatchToken" = null,
                     "claimAttempt" = null,
                     "publishedAt" = null,
                     "availableAt" = coalesce($4::timestamptz, now()),
                     "updatedAt" = now()
                 where "objectRemoteId" = $1::uuid
                   and "dispatchToken" = $2::uuid
                   and "claimAttempt" = $3::integer`,
		[remoteId, executionId, claimAttempt, availableAt]
	);
	await notifyHistoryArchiveReadyWork(manager);
}

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
