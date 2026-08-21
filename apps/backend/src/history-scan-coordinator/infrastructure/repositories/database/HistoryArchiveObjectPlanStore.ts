import type { EntityManager, Repository } from 'typeorm';
import type { HistoryArchiveObject } from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveObject.js';
import type { HistoryArchiveObjectPlanPromotionResult } from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveObjectRepository.js';
import { getHistoryArchiveBrokerMaximumPriority } from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveBrokerPriority.js';
import {
	calculateHistoryArchivePlanningPressure,
	historyArchiveMaximumWatermark,
	historyArchivePerRootFrontier,
	historyArchiveThroughputSampleCap,
	historyArchiveThroughputWindowMinutes
} from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveObjectPlanningPolicy.js';
import { requeueStaleHistoryArchiveStateObjects } from './HistoryArchiveObjectStateRefreshQuery.js';
import {
	enqueueHistoryArchiveReadyArchives,
	buildHistoryArchiveReadyPressureSql,
	historyArchiveReadyRootActivityCtesSql,
	synchronizeHistoryArchiveReadyQueue
} from './HistoryArchiveObjectReadyQueue.js';

const planChunkSize = 200;
const genesisCheckpointLedger = 63;
const promotionLockName = 'history_archive_object_plan_promotion';
const promotionRootIndexName = 'idx_history_archive_object_plan_root_created';
const promotionPriorityIndexName =
	'idx_history_archive_object_plan_root_priority_created';

export function isHistoryArchivePlanPromotionEnabled(
	env: NodeJS.ProcessEnv = process.env
): boolean {
	return env.HISTORY_ARCHIVE_PLAN_PROMOTION_ENABLED !== 'false';
}

export async function planHistoryArchiveObjects(
	repository: Repository<HistoryArchiveObject>,
	objects: readonly HistoryArchiveObject[]
): Promise<number> {
	const refreshed = await requeueStaleHistoryArchiveStateObjects(
		repository.manager,
		objects
	);
	let planned = 0;
	for (let offset = 0; offset < objects.length; offset += planChunkSize) {
		const chunk = objects.slice(offset, offset + planChunkSize);
		const values = chunk.map((object) => ({
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
		await enqueueHistoryArchiveReadyArchives(
			repository.manager,
			chunk.map((object) => object.archiveUrlIdentity)
		);
		planned += rows.length;
	}
	return planned + refreshed;
}

export async function promoteHistoryArchiveObjectPlans(
	repository: Repository<HistoryArchiveObject>
): Promise<HistoryArchiveObjectPlanPromotionResult> {
	if (!isHistoryArchivePlanPromotionEnabled()) return emptyPromotionResult();
	const maximumPriority = getHistoryArchiveBrokerMaximumPriority();

	return await repository.manager.transaction(async (manager) => {
		const [lock] = (await manager.query(
			'select pg_try_advisory_xact_lock(hashtext($1)) as locked',
			[promotionLockName]
		)) as readonly { readonly locked?: boolean }[];
		if (lock?.locked !== true) return emptyPromotionResult();
		await assertPromotionIndexesReady(manager);

		const [counts] = (await manager.query(
			buildHistoryArchiveReadyPressureSql(maximumPriority),
			[historyArchiveThroughputSampleCap, historyArchiveThroughputWindowMinutes]
		)) as readonly {
			readonly outstandingObjects: number | string;
			readonly recentCompletions: number | string;
		}[];
		const pressure = calculateHistoryArchivePlanningPressure({
			outstandingObjects: Number(counts?.outstandingObjects ?? 0),
			recentCompletions: Number(counts?.recentCompletions ?? 0)
		});
		const maximumWatermarkHeadroom = Math.max(
			0,
			historyArchiveMaximumWatermark - pressure.outstandingObjects
		);
		if (pressure.availableSlots === 0 && maximumWatermarkHeadroom === 0) {
			return { ...pressure, promotedObjects: 0 };
		}

		const [result] = (await manager.query(historyArchivePlanPromotionSql, [
			pressure.availableSlots,
			historyArchivePerRootFrontier,
			genesisCheckpointLedger,
			maximumWatermarkHeadroom,
			maximumPriority
		])) as readonly { readonly promotedObjects: number | string }[];
		const promotedObjects = Number(result?.promotedObjects ?? 0);
		if (promotedObjects > 0)
			await synchronizeHistoryArchiveReadyQueue(
				manager,
				historyArchiveMaximumWatermark
			);

		return {
			...pressure,
			promotedObjects
		};
	});
}

async function assertPromotionIndexesReady(
	manager: EntityManager
): Promise<void> {
	const [state] = (await manager.query(
		`
			select count(*) = 2 as ready
			from pg_index
			where indexrelid = any(array[
				to_regclass($1),
				to_regclass($2)
			])
				and indisvalid
				and indisready
		`,
		[promotionRootIndexName, promotionPriorityIndexName]
	)) as readonly { readonly ready?: boolean }[];
	if (state?.ready !== true) {
		throw new Error(
			'History archive plan promotion requires valid bounded-plan indexes'
		);
	}
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

export const historyArchivePlanPromotionSql = `
	with recursive ${historyArchiveReadyRootActivityCtesSql}, plan_roots as (
		(
			select plan."archiveUrlIdentity", plan."createdAt" as root_created_at
			from "history_archive_object_plan" plan
			order by plan."archiveUrlIdentity", plan."createdAt", plan.id
			limit 1
		)
		union all
		select next_root."archiveUrlIdentity", next_root.root_created_at
		from plan_roots previous_root
		cross join lateral (
			select plan."archiveUrlIdentity", plan."createdAt" as root_created_at
			from "history_archive_object_plan" plan
			where plan."archiveUrlIdentity" > previous_root."archiveUrlIdentity"
			order by plan."archiveUrlIdentity", plan."createdAt", plan.id
			limit 1
		) next_root
	), roots_with_capacity as (
		select root."archiveUrlIdentity", root.root_created_at,
			greatest(
				$2::integer - coalesce(active.active_count, 0),
				0
			) as capacity
		from plan_roots root
		left join active_by_root active
			on active."archiveUrlIdentity" = root."archiveUrlIdentity"
		where coalesce(active.active_count, 0) < $2::integer
	), candidates as materialized (
		select candidate.id, candidate.proof_priority, candidate.root_rank,
			root.root_created_at, root."archiveUrlIdentity"
		from roots_with_capacity root
		cross join lateral (
			select prioritized.id, prioritized.proof_priority,
				row_number() over (
					order by prioritized.proof_priority,
						prioritized."createdAt", prioritized.id
				) as root_rank
			from (
				select plan.id, plan."createdAt",
					case when plan."checkpointLedger" = $3::integer then 0 else 1 end
						as proof_priority
				from "history_archive_object_plan" plan
				where plan."archiveUrlIdentity" = root."archiveUrlIdentity"
					and case when plan."checkpointLedger" = $3::integer
						then 0 else 2 end <= $5::smallint
				order by
					(plan."checkpointLedger" is distinct from $3::integer),
					plan."createdAt",
					plan.id
				limit root.capacity
			) prioritized
	) candidate
	), selected as (
		select id
		from candidates
		order by
			proof_priority,
			root_rank,
			root_created_at,
			"archiveUrlIdentity",
			id
		limit greatest(
			$1::integer,
			least(
					$4::integer,
					(
						select count(*)::integer
						from candidates critical
						where critical.proof_priority = 0
					)
				)
			)
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
			'executable',
			case when plan."checkpointLedger" = $3::integer
				then 'canonical-frontier-reserve'
				else 'planned-frontier'
			end,
			now(),
			now(), now()
		from "history_archive_object_plan" plan
		join selected on selected.id = plan.id
                on conflict ("archiveUrlIdentity", "objectType", "objectKey") do update
                set "dependencyReady" =
                                "history_archive_object_queue"."dependencyReady" is true
                                or excluded."dependencyReady" is true,
                        "executionDisposition" = 'executable',
                        "executionReason" = excluded."executionReason",
                        "executionDispositionAt" = now(),
                        "updatedAt" = now()
                where "history_archive_object_queue".status = 'pending'
                        and "history_archive_object_queue"."executionDisposition"
                                is distinct from 'executable'
		returning id
	), deleted as (
		delete from "history_archive_object_plan" plan
		using selected
		where plan.id = selected.id
		returning plan.id
	)
	select count(*)::integer as "promotedObjects" from inserted
`;
