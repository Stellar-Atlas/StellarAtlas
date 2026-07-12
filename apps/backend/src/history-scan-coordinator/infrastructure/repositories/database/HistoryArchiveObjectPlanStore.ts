import type { Repository } from 'typeorm';
import type { HistoryArchiveObject } from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveObject.js';
import type { HistoryArchiveObjectPlanPromotionResult } from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveObjectRepository.js';
import {
	calculateHistoryArchivePlanningPressure,
	historyArchiveMaximumWatermark,
	historyArchivePerRootFrontier,
	historyArchiveThroughputSampleCap,
	historyArchiveThroughputWindowMinutes
} from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveObjectPlanningPolicy.js';

const planChunkSize = 200;
const promotionLockName = 'history_archive_object_plan_promotion';

export async function planHistoryArchiveObjects(
	repository: Repository<HistoryArchiveObject>,
	objects: readonly HistoryArchiveObject[]
): Promise<number> {
	let planned = 0;
	for (let offset = 0; offset < objects.length; offset += planChunkSize) {
		const values = objects
			.slice(offset, offset + planChunkSize)
			.map((object) => ({
				archiveUrl: object.archiveUrl,
				archiveUrlIdentity: object.archiveUrlIdentity,
				bucketHash: object.bucketHash,
				checkpointLedger: object.checkpointLedger,
				dependencyReady: object.dependencyReady === true,
				hostIdentity: object.hostIdentity,
				objectKey: object.objectKey,
				objectOrder: object.objectOrder,
				objectType: object.objectType,
				objectUrl: object.objectUrl,
				remoteId: object.remoteId,
				status: object.status
			}));
		const rows = (await repository.manager.query(planObjectsSql, [
			JSON.stringify(values)
		])) as readonly unknown[];
		planned += rows.length;
	}
	return planned;
}

export async function promoteHistoryArchiveObjectPlans(
	repository: Repository<HistoryArchiveObject>
): Promise<HistoryArchiveObjectPlanPromotionResult> {
	return await repository.manager.transaction(async (manager) => {
		const [lock] = (await manager.query(
			'select pg_try_advisory_xact_lock(hashtext($1)) as locked',
			[promotionLockName]
		)) as readonly { readonly locked?: boolean }[];
		if (lock?.locked !== true) return emptyPromotionResult();

		const [counts] = (await manager.query(queuePressureSql, [
			historyArchiveMaximumWatermark + 1,
			historyArchiveThroughputSampleCap,
			historyArchiveThroughputWindowMinutes
		])) as readonly {
			readonly outstandingObjects: number | string;
			readonly recentCompletions: number | string;
		}[];
		const pressure = calculateHistoryArchivePlanningPressure({
			outstandingObjects: Number(counts?.outstandingObjects ?? 0),
			recentCompletions: Number(counts?.recentCompletions ?? 0)
		});
		if (pressure.availableSlots === 0) {
			return { ...pressure, promotedObjects: 0 };
		}

		const [result] = (await manager.query(promotePlansSql, [
			pressure.availableSlots,
			historyArchivePerRootFrontier
		])) as readonly { readonly promotedObjects: number | string }[];

		return {
			...pressure,
			promotedObjects: Number(result?.promotedObjects ?? 0)
		};
	});
}

function emptyPromotionResult(): HistoryArchiveObjectPlanPromotionResult {
	return {
		availableSlots: 0,
		outstandingObjects: 0,
		promotedObjects: 0,
		recentCompletions: 0,
		watermark: 0
	};
}

const planObjectsSql = `
	with input as (
		select *
		from jsonb_to_recordset($1::jsonb) as object(
			"remoteId" uuid,
			"archiveUrl" text,
			"archiveUrlIdentity" text,
			"hostIdentity" text,
			"objectType" text,
			"objectKey" text,
			"objectOrder" integer,
			"objectUrl" text,
			status text,
			"checkpointLedger" integer,
			"bucketHash" text,
			"dependencyReady" boolean
		)
	), activated as (
		update "history_archive_object_queue" queued
		set "dependencyReady" = true
		from input
		where input."dependencyReady" = true
			and queued."archiveUrlIdentity" = input."archiveUrlIdentity"
			and queued."objectType" = input."objectType"
			and queued."objectKey" = input."objectKey"
			and queued."dependencyReady" is distinct from true
		returning queued.id
	)
	insert into "history_archive_object_plan" (
		"remoteId", "archiveUrl", "archiveUrlIdentity", "hostIdentity",
		"objectType", "objectKey", "objectOrder", "objectUrl", status,
		"checkpointLedger", "bucketHash", "dependencyReady"
	)
	select
		input."remoteId", input."archiveUrl", input."archiveUrlIdentity",
		input."hostIdentity", input."objectType", input."objectKey",
		input."objectOrder", input."objectUrl", input.status,
		input."checkpointLedger", input."bucketHash", input."dependencyReady"
	from input
	where not exists (
		select 1 from "history_archive_object_queue" queued
		where queued."archiveUrlIdentity" = input."archiveUrlIdentity"
			and queued."objectType" = input."objectType"
			and queued."objectKey" = input."objectKey"
	)
	on conflict ("archiveUrlIdentity", "objectType", "objectKey") do nothing
	returning id
`;

const queuePressureSql = `
	with outstanding as (
		select 1
		from "history_archive_object_queue"
		where status in ('pending', 'scanning', 'failed')
			and (
				status = 'scanning'
				or (
					"executionDisposition" = 'executable'
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
				)
			)
		limit $1
	), recent_events as (
		select 1
		from "history_archive_object_event"
		where "eventType" = 'verified'
			and "createdAt" >=
			now() - make_interval(mins => $3::integer)
		limit $2
	)
	select
		(select count(*)::integer from outstanding) as "outstandingObjects",
		(select count(*)::integer from recent_events) as "recentCompletions"
`;

const promotePlansSql = `
	with active_by_root as (
		select "archiveUrlIdentity", count(*)::integer as active_count
		from "history_archive_object_queue"
		where status = 'scanning'
			or (
				status = 'pending'
				and "executionDisposition" = 'executable'
				and "dependencyReady" = true
			)
			or (
				status = 'failed'
				and "executionDisposition" = 'executable'
				and "dependencyReady" = true
				and coalesce(
					"nextAttemptAt",
					"updatedAt" + interval '1 hour'
				) <= now()
			)
		group by "archiveUrlIdentity"
	), ranked as (
		select
			plan.*,
			coalesce(active.active_count, 0) as active_count,
			row_number() over (
				partition by plan."archiveUrlIdentity"
				order by plan."createdAt", plan.id
			) as root_rank,
			min(plan."createdAt") over (
				partition by plan."archiveUrlIdentity"
			) as root_created_at
		from "history_archive_object_plan" plan
		left join active_by_root active
			on active."archiveUrlIdentity" = plan."archiveUrlIdentity"
	), selected as (
		select id
		from ranked
		where root_rank <= greatest($2 - active_count, 0)
		order by root_rank, root_created_at, "archiveUrlIdentity", id
		limit $1
	), inserted as (
		insert into "history_archive_object_queue" (
			"remoteId", "archiveUrl", "archiveUrlIdentity", "hostIdentity",
			"objectType", "objectKey", "objectOrder", "objectUrl", status,
			"checkpointLedger", "bucketHash", "dependencyReady",
			"executionDisposition", "executionReason", "executionDispositionAt",
			"createdAt", "updatedAt"
		)
		select
			plan."remoteId", plan."archiveUrl", plan."archiveUrlIdentity",
			plan."hostIdentity", plan."objectType", plan."objectKey",
			plan."objectOrder", plan."objectUrl", plan.status,
			plan."checkpointLedger", plan."bucketHash", plan."dependencyReady",
			'executable', 'planned-frontier', now(),
			now(), now()
		from "history_archive_object_plan" plan
		join selected on selected.id = plan.id
		on conflict ("archiveUrlIdentity", "objectType", "objectKey") do nothing
		returning id
	), deleted as (
		delete from "history_archive_object_plan" plan
		using selected
		where plan.id = selected.id
		returning plan.id
	)
	select count(*)::integer as "promotedObjects" from inserted
`;
