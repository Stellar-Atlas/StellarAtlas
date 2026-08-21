import type { EntityManager, Repository } from 'typeorm';
import type { HistoryArchiveObject } from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveObject.js';

const maximumPlanRows = 4_096;
const maximumCheckpointFanoutBatch = 3;
const maximumCheckpointCursorBatch = 128;

export async function findVerifiedCheckpointsNeedingFanout(
	repository: Repository<HistoryArchiveObject>,
	limit: number
): Promise<readonly HistoryArchiveObject[]> {
	const requestedLimit = Math.max(
		0,
		Math.min(limit, maximumCheckpointFanoutBatch)
	);
	if (requestedLimit === 0) return [];

	const [pressure] = (await repository.manager.query(
		`
			select count(*)::integer as count
			from (
				select 1
				from "history_archive_object_plan"
				limit $1
			) bounded
		`,
		[maximumPlanRows]
	)) as readonly { readonly count: number | string }[];
	const planRows = Number(pressure?.count ?? maximumPlanRows);
	const availableCheckpoints = Math.floor(
		Math.max(0, maximumPlanRows - planRows) / 64
	);
	const safeLimit = Math.min(requestedLimit, availableCheckpoints);
	if (safeLimit === 0) return [];

	return await repository
		.createQueryBuilder('object')
		.where('object.objectType = :objectType', {
			objectType: 'checkpoint-state'
		})
		.andWhere('object.status = :status', { status: 'verified' })
		.andWhere('object.descendantsPlannedAt is null')
		.orderBy('object.verifiedAt', 'DESC', 'NULLS LAST')
		.addOrderBy('object.id', 'ASC')
		.take(safeLimit)
		.getMany();
}

export async function markCheckpointDescendantsPlanned(
	repository: Repository<HistoryArchiveObject>,
	remoteId: string
): Promise<boolean> {
	const result = await repository
		.createQueryBuilder()
		.update()
		.set({ descendantsPlannedAt: () => 'now()' })
		.where('"remoteId" = :remoteId', { remoteId })
		.andWhere('"objectType" = :objectType', {
			objectType: 'checkpoint-state'
		})
		.andWhere('status = :status', { status: 'verified' })
		.andWhere('"descendantsPlannedAt" is null')
		.execute();
	return (result.affected ?? 0) === 1;
}

export async function materializeCompactCheckpointPlans(
	manager: EntityManager
): Promise<number> {
	const [result] = (await manager.query(compactCheckpointPlanSql, [
		maximumPlanRows,
		maximumCheckpointCursorBatch
	])) as readonly { readonly planned: number | string }[];
	return Number(result?.planned ?? 0);
}

const compactCheckpointPlanSql = `
	with available_roots as materialized (
		select state."archiveUrlIdentity", state."currentLedger",
			root."archiveUrl", root."hostIdentity",
			(
				floor((state."currentLedger" + 1)::numeric / 64) * 64 - 1
			)::integer as latest_checkpoint
		from "history_archive_state_snapshot" state
		join "history_archive_object_queue" root
			on root."archiveUrlIdentity" = state."archiveUrlIdentity"
			and root."objectType" = 'history-archive-state'
			and root."objectKey" = 'root'
			and root.status = 'verified'
		where state.status = 'available'
			and state."currentLedger" >= 63
	), seeded as (
		insert into "history_archive_checkpoint_scan_cursor" (
			"archiveUrlIdentity", "latestCheckpointLedger",
			"lastForwardCheckpointLedger", "nextHistoricalCheckpointLedger"
		)
		select root."archiveUrlIdentity", root.latest_checkpoint,
			null, case when root.latest_checkpoint > 63
				then root.latest_checkpoint - 64 else null end
		from available_roots root
		on conflict ("archiveUrlIdentity") do update
		set "latestCheckpointLedger" = greatest(
				"history_archive_checkpoint_scan_cursor"."latestCheckpointLedger",
				excluded."latestCheckpointLedger"
			),
			"updatedAt" = case
				when excluded."latestCheckpointLedger" >
					"history_archive_checkpoint_scan_cursor"."latestCheckpointLedger"
				then now()
				else "history_archive_checkpoint_scan_cursor"."updatedAt"
			end
		returning "archiveUrlIdentity"
	), plan_pressure as materialized (
		select count(*)::integer as count
		from (
			select 1 from "history_archive_object_plan" limit $1
		) bounded
	), cursor_candidates as materialized (
		select cursor."archiveUrlIdentity", cursor."latestCheckpointLedger",
			cursor."lastForwardCheckpointLedger",
			cursor."nextHistoricalCheckpointLedger",
			case
				when cursor."lastForwardCheckpointLedger" is null
					or cursor."lastForwardCheckpointLedger" <
						cursor."latestCheckpointLedger"
					then cursor."latestCheckpointLedger"
				else cursor."nextHistoricalCheckpointLedger"
			end as checkpoint_ledger
		from "history_archive_checkpoint_scan_cursor" cursor
		cross join plan_pressure pressure
		where pressure.count < $1
			and (
				cursor."lastForwardCheckpointLedger" is null
				or cursor."lastForwardCheckpointLedger" <
					cursor."latestCheckpointLedger"
				or cursor."nextHistoricalCheckpointLedger" is not null
			)
		order by cursor."updatedAt", cursor."archiveUrlIdentity"
                limit (select least($2, greatest($1 - count, 0)) from plan_pressure)
		for update of cursor skip locked
	), source as materialized (
		select candidate.*, root."archiveUrl", root."hostIdentity",
			lpad(to_hex(candidate.checkpoint_ledger), 8, '0') as checkpoint_hex
		from cursor_candidates candidate
		join available_roots root
			on root."archiveUrlIdentity" = candidate."archiveUrlIdentity"
		where candidate.checkpoint_ledger >= 63
	), inserted as (
		insert into "history_archive_object_plan" (
			"remoteId", "archiveUrl", "archiveUrlIdentity", "hostIdentity",
			"objectType", "objectKey", "objectOrder", "objectUrl", status,
			"checkpointLedger", "dependencyReady"
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
			'pending', source.checkpoint_ledger, true
		from source
		on conflict ("archiveUrlIdentity", "objectType", "objectKey")
			do nothing
		returning id
	), advanced as (
		update "history_archive_checkpoint_scan_cursor" cursor
		set "lastForwardCheckpointLedger" = case
				when candidate.checkpoint_ledger =
					candidate."latestCheckpointLedger"
					then candidate.checkpoint_ledger
				else cursor."lastForwardCheckpointLedger"
			end,
			"nextHistoricalCheckpointLedger" = case
				when candidate.checkpoint_ledger =
					candidate."nextHistoricalCheckpointLedger"
					and candidate.checkpoint_ledger > 63
					then candidate.checkpoint_ledger - 64
				when candidate.checkpoint_ledger =
					candidate."nextHistoricalCheckpointLedger"
					then null
				else cursor."nextHistoricalCheckpointLedger"
			end,
			"updatedAt" = now()
		from cursor_candidates candidate
		where cursor."archiveUrlIdentity" = candidate."archiveUrlIdentity"
		returning cursor."archiveUrlIdentity"
	)
	select (select count(*) from inserted)::integer as planned
`;
