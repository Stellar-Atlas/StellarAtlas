import type { EntityManager, Repository } from 'typeorm';
import type { HistoryArchiveObject } from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveObject.js';
import { historyArchiveObjectOpenSequentialCohortSql } from './HistoryArchiveSequentialChainSql.js';

const maximumPlanRows = 4_096;
const maximumCheckpointFanoutBatch = 24;
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
		.andWhere(historyArchiveObjectOpenSequentialCohortSql('object'))
		.orderBy('object.checkpointLedger', 'ASC', 'NULLS LAST')
		.addOrderBy('object.verifiedAt', 'ASC', 'NULLS LAST')
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
		maximumCheckpointCursorBatch
	])) as readonly { readonly planned: number | string }[];
	return Number(result?.planned ?? 0);
}

export async function materializeNextCompactCheckpointPlan(
	manager: EntityManager,
	archiveUrlIdentity: string,
	completedCheckpointLedger: number
): Promise<number> {
	if (
		!Number.isSafeInteger(completedCheckpointLedger) ||
		completedCheckpointLedger < 63
	) {
		return 0;
	}
	const [result] = (await manager.query(targetedCompactCheckpointPlanSql, [
		archiveUrlIdentity,
		completedCheckpointLedger
	])) as readonly { readonly planned: number | string }[];
	return Number(result?.planned ?? 0);
}

const targetedCompactCheckpointPlanSql = `
	with candidate as materialized (
		select cursor."archiveUrlIdentity",
			greatest(
				cursor."latestCheckpointLedger",
				(
					floor((state."currentLedger" + 1)::numeric / 64) * 64 - 1
				)::integer
			) as "latestCheckpointLedger",
			cursor."lastForwardCheckpointLedger",
			cursor."nextHistoricalCheckpointLedger" as checkpoint_ledger,
			root."archiveUrl", root."hostIdentity"
		from "history_archive_checkpoint_scan_cursor" cursor
		join "history_archive_state_snapshot" state
			on state."archiveUrlIdentity" = cursor."archiveUrlIdentity"
			and state.status = 'available'
			and state."currentLedger" >= 63
		join "history_archive_object_queue" root
			on root."archiveUrlIdentity" = cursor."archiveUrlIdentity"
			and root."objectType" = 'history-archive-state'
			and root."objectKey" = 'root'
			and root.status = 'verified'
			and state."archiveUrlIdentity" = regexp_replace(root."archiveUrl", '/+$', '')
		join "history_archive_checkpoint_proof" proof
			on proof."archiveUrlIdentity" = cursor."archiveUrlIdentity"
			and proof."checkpointLedger" = $2::integer
			and proof.status = 'verified'
		where cursor."archiveUrlIdentity" = $1::text
			and cursor."nextHistoricalCheckpointLedger" = $2::integer + 64
			and cursor."nextHistoricalCheckpointLedger" <= greatest(
				cursor."latestCheckpointLedger",
				(
					floor((state."currentLedger" + 1)::numeric / 64) * 64 - 1
				)::integer
			)
		for update of cursor
	), source as materialized (
		select candidate.*,
			lpad(to_hex(candidate.checkpoint_ledger), 8, '0') as checkpoint_hex
		from candidate
	), inserted as (
		insert into "history_archive_object_queue" (
			"remoteId", "archiveUrl", "archiveUrlIdentity", "hostIdentity",
			"objectType", "objectKey", "objectOrder", "objectUrl", status,
			"checkpointLedger", "dependencyReady",
			"executionDisposition", "executionReason", "executionDispositionAt"
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
			'executable', 'planned-frontier', now()
		from source
		on conflict ("archiveUrlIdentity", "objectType", "objectKey")
			do update
			set "dependencyReady" = true,
				"executionDisposition" = 'executable',
				"executionReason" = 'planned-frontier',
				"executionDispositionAt" = now(),
				"updatedAt" = now()
			where "history_archive_object_queue".status = 'pending'
		returning "remoteId", "archiveUrlIdentity"
	), advanced as (
		update "history_archive_checkpoint_scan_cursor" cursor
		set "latestCheckpointLedger" = source."latestCheckpointLedger",
			"lastForwardCheckpointLedger" = case
				when source.checkpoint_ledger = source."latestCheckpointLedger"
					then source.checkpoint_ledger
				else cursor."lastForwardCheckpointLedger"
			end,
			"nextHistoricalCheckpointLedger" = source.checkpoint_ledger + 64,
			"updatedAt" = now()
		from source
		where cursor."archiveUrlIdentity" = source."archiveUrlIdentity"
		returning cursor."archiveUrlIdentity"
	), ready as (
		insert into "history_archive_object_ready" (
			"objectRemoteId", "archiveUrlIdentity", priority, "availableAt",
			"createdAt", "updatedAt"
		)
		select inserted."remoteId", inserted."archiveUrlIdentity", 2, now(),
			now(), now()
		from inserted
		join advanced using ("archiveUrlIdentity")
		on conflict ("objectRemoteId") do nothing
		returning "objectRemoteId"
	)
	select (select count(*) from inserted)::integer as planned,
		(select count(*) from ready)::integer as ready
`;

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
                        and state."archiveUrlIdentity" = regexp_replace(root."archiveUrl", '/+$', '')
		where state.status = 'available'
			and state."currentLedger" >= 63
	), seeded as (
		insert into "history_archive_checkpoint_scan_cursor" (
			"archiveUrlIdentity", "latestCheckpointLedger",
			"lastForwardCheckpointLedger", "nextHistoricalCheckpointLedger"
		)
                select root."archiveUrlIdentity", root.latest_checkpoint,
                        null, 63
		from available_roots root
                on conflict ("archiveUrlIdentity") do nothing
		returning "archiveUrlIdentity"
        ), cursor_candidates as materialized (
                select cursor."archiveUrlIdentity",
                        greatest(
                                cursor."latestCheckpointLedger",
                                root.latest_checkpoint
                        ) as "latestCheckpointLedger",
                        cursor."lastForwardCheckpointLedger",
                        cursor."nextHistoricalCheckpointLedger",
                        cursor."nextHistoricalCheckpointLedger" as checkpoint_ledger
                from "history_archive_checkpoint_scan_cursor" cursor
                join available_roots root
                        on root."archiveUrlIdentity" = cursor."archiveUrlIdentity"
                where cursor."nextHistoricalCheckpointLedger" is not null
                        and cursor."nextHistoricalCheckpointLedger" <= greatest(
                                cursor."latestCheckpointLedger",
                                root.latest_checkpoint
                        )
                        and (
                                cursor."nextHistoricalCheckpointLedger" = 63
                                or exists (
                                        select 1
                                        from "history_archive_checkpoint_proof" predecessor
                                        where predecessor."archiveUrlIdentity" =
                                                cursor."archiveUrlIdentity"
                                                and predecessor."checkpointLedger" =
                                                        cursor."nextHistoricalCheckpointLedger" - 64
                                                and predecessor.status = 'verified'
                                )
                        )
                order by cursor."nextHistoricalCheckpointLedger",
                        cursor."updatedAt",
                        cursor."archiveUrlIdentity"
                limit $1
                for update of cursor skip locked
	), source as materialized (
		select candidate.*, root."archiveUrl", root."hostIdentity",
			lpad(to_hex(candidate.checkpoint_ledger), 8, '0') as checkpoint_hex
		from cursor_candidates candidate
		join available_roots root
			on root."archiveUrlIdentity" = candidate."archiveUrlIdentity"
		where candidate.checkpoint_ledger >= 63
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
			'executable', 'planned-frontier', now()
		from source
		on conflict ("archiveUrlIdentity", "objectType", "objectKey")
			do update
			set "dependencyReady" = true,
				"executionDisposition" = 'executable',
				"executionReason" = 'planned-frontier',
				"executionDispositionAt" = now(),
				"updatedAt" = now()
			where "history_archive_object_queue".status = 'pending'
		returning id
	), advanced as (
		update "history_archive_checkpoint_scan_cursor" cursor
                set "latestCheckpointLedger" = candidate."latestCheckpointLedger",
                        "lastForwardCheckpointLedger" = case
				when candidate.checkpoint_ledger =
					candidate."latestCheckpointLedger"
					then candidate.checkpoint_ledger
				else cursor."lastForwardCheckpointLedger"
			end,
                        "nextHistoricalCheckpointLedger" =
                                candidate.checkpoint_ledger + 64,
			"updatedAt" = now()
		from cursor_candidates candidate
		where cursor."archiveUrlIdentity" = candidate."archiveUrlIdentity"
		returning cursor."archiveUrlIdentity"
	)
	select (select count(*) from inserted)::integer as planned
`;
