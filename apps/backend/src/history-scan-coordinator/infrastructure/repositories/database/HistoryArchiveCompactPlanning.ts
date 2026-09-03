import type { EntityManager, Repository } from 'typeorm';
import type { HistoryArchiveObject } from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveObject.js';
import {
	historyArchiveCheckpointFanoutBatchSize,
	historyArchiveSequentialPrefetchDepth
} from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveObjectPlanningPolicy.js';
import {
	getHistoryArchiveCanonicalFirstRoot,
	historyArchiveCanonicalFirstAdmissionSql,
	historyArchiveCanonicalFirstScopeSelectSql
} from './HistoryArchiveCanonicalFirst.js';
import { notifyHistoryArchiveReadyWork } from './HistoryArchiveObjectReadyQueue.js';

const maximumCheckpointFanoutBatch = historyArchiveCheckpointFanoutBatchSize;
const maximumCheckpointCursorBatch = 128;
const checkpointFanoutLedgerSpan =
	(historyArchiveSequentialPrefetchDepth - 1) * 64;

export async function findVerifiedCheckpointsNeedingFanout(
	repository: Repository<HistoryArchiveObject>,
	limit: number
): Promise<readonly HistoryArchiveObject[]> {
	const requestedLimit = Math.max(
		0,
		Math.min(limit, maximumCheckpointFanoutBatch)
	);
	if (requestedLimit === 0) return [];

	const safeLimit = requestedLimit;

	const query = repository
		.createQueryBuilder('object')
		.addCommonTableExpression(
			historyArchiveCanonicalFirstScopeSelectSql(
				'cast(:canonicalRoot as text)'
			),
			'canonical_scope',
			{ materialized: true }
		)
		.innerJoin(
			'history_archive_checkpoint_scan_cursor',
			'fanout_cursor',
			`fanout_cursor."archiveUrlIdentity" = object."archiveUrlIdentity"
				and object."checkpointLedger" between
					fanout_cursor."nextHistoricalCheckpointLedger" - 64
					and fanout_cursor."nextHistoricalCheckpointLedger" - 64 +
						${checkpointFanoutLedgerSpan}`
		)
		.where('object.objectType = :objectType', {
			objectType: 'checkpoint-state'
		})
		.andWhere('object.status = :status', { status: 'verified' })
		.andWhere(
			historyArchiveCanonicalFirstAdmissionSql(
				'object."archiveUrlIdentity"',
				'cast(:canonicalRoot as text)'
			),
			{ canonicalRoot: getHistoryArchiveCanonicalFirstRoot() }
		)
		.andWhere(
			`(
				object."descendantsPlannedAt" is null
				or not exists (
					select 1
					from "history_archive_object_queue" sibling
					where sibling."archiveUrlIdentity" =
						object."archiveUrlIdentity"
						and sibling."objectType" = 'ledger'
						and sibling."objectKey" = 'ledger:' ||
							lpad(to_hex(object."checkpointLedger"), 8, '0')
				)
				or not exists (
					select 1
					from "history_archive_object_queue" sibling
					where sibling."archiveUrlIdentity" =
						object."archiveUrlIdentity"
						and sibling."objectType" = 'transactions'
						and sibling."objectKey" = 'transactions:' ||
							lpad(to_hex(object."checkpointLedger"), 8, '0')
				)
				or not exists (
					select 1
					from "history_archive_object_queue" sibling
					where sibling."archiveUrlIdentity" =
						object."archiveUrlIdentity"
						and sibling."objectType" = 'results'
						and sibling."objectKey" = 'results:' ||
							lpad(to_hex(object."checkpointLedger"), 8, '0')
				)
				or not exists (
					select 1
					from "history_archive_checkpoint_bucket_dependency" dependency
					where dependency."archiveUrlIdentity" =
						object."archiveUrlIdentity"
						and dependency."checkpointLedger" =
							object."checkpointLedger"
				)
				or exists (
					select 1
					from "history_archive_checkpoint_bucket_dependency" dependency
					where dependency."archiveUrlIdentity" =
						object."archiveUrlIdentity"
						and dependency."checkpointLedger" =
							object."checkpointLedger"
						and not exists (
							select 1
							from "history_archive_object_queue" bucket
							where bucket."archiveUrlIdentity" =
								object."archiveUrlIdentity"
								and bucket."objectType" = 'bucket'
								and bucket."objectKey" =
									'bucket:' || dependency."bucketHash"
						)
				)
			)`
		)
		.orderBy('object.checkpointLedger', 'ASC', 'NULLS LAST')
		.addOrderBy('object.verifiedAt', 'ASC', 'NULLS LAST')
		.addOrderBy('object.id', 'ASC')
		.take(safeLimit);

	return await query.getMany();
}

export async function markCheckpointDescendantsPlanned(
	repository: Repository<HistoryArchiveObject>,
	remoteId: string
): Promise<boolean> {
	return (
		(await markCheckpointDescendantsPlannedBatch(repository, [remoteId])) === 1
	);
}

export async function markCheckpointDescendantsPlannedBatch(
	repository: Repository<HistoryArchiveObject>,
	remoteIds: readonly string[]
): Promise<number> {
	const uniqueRemoteIds = [...new Set(remoteIds)];
	if (uniqueRemoteIds.length === 0) return 0;
	const rows = (await repository.manager.query(
		markCheckpointDescendantsPlannedSql,
		[uniqueRemoteIds]
	)) as readonly unknown[];
	return rows.length;
}

const markCheckpointDescendantsPlannedSql = `
        update "history_archive_object_queue"
        set "descendantsPlannedAt" = now(),
		"transitionEffectsCompletedAt" = now(),
		"updatedAt" = now()
        where "remoteId" = any($1::uuid[])
                and "objectType" = 'checkpoint-state'
                and status = 'verified'
                and "descendantsPlannedAt" is null
        returning id
`;

export interface HistoryArchiveCompactCheckpointPlanResult {
	readonly advanced: number;
	readonly planned: number;
	readonly ready: number;
}

export async function materializeCompactCheckpointPlanResult(
	manager: EntityManager,
	archiveUrlIdentities: readonly string[] | null = null
): Promise<HistoryArchiveCompactCheckpointPlanResult> {
	const targetedIdentities =
		archiveUrlIdentities === null
			? null
			: [...new Set(archiveUrlIdentities)].filter(
					(identity) => identity.length > 0
				);
	if (targetedIdentities !== null && targetedIdentities.length === 0)
		return { advanced: 0, planned: 0, ready: 0 };
	const [result] = (await manager.query(compactCheckpointPlanSql, [
		maximumCheckpointCursorBatch,
		historyArchiveSequentialPrefetchDepth,
		targetedIdentities,
		getHistoryArchiveCanonicalFirstRoot()
	])) as readonly {
		readonly planned: number | string;
		readonly ready?: number | string;
		readonly advanced?: number | string;
	}[];
	const plan = {
		advanced: Number(result?.advanced ?? 0),
		planned: Number(result?.planned ?? 0),
		ready: Number(result?.ready ?? 0)
	};
	if (plan.ready > 0 || plan.advanced > 0)
		await notifyHistoryArchiveReadyWork(manager);
	return plan;
}

export async function materializeCompactCheckpointPlans(
	manager: EntityManager,
	archiveUrlIdentities: readonly string[] | null = null
): Promise<number> {
	return (
		await materializeCompactCheckpointPlanResult(manager, archiveUrlIdentities)
	).planned;
}

export interface CompletedHistoryArchiveCheckpoint {
	readonly archiveUrlIdentity: string;
	readonly checkpointLedger: number;
}

export async function materializeNextCompactCheckpointPlans(
	manager: EntityManager,
	completedCheckpoints: readonly CompletedHistoryArchiveCheckpoint[]
): Promise<number> {
	const validCheckpoints = completedCheckpoints.filter(
		(checkpoint) =>
			checkpoint.archiveUrlIdentity.length > 0 &&
			Number.isSafeInteger(checkpoint.checkpointLedger) &&
			checkpoint.checkpointLedger >= 63
	);
	if (validCheckpoints.length === 0) return 0;
	const [result] = (await manager.query(targetedCompactCheckpointPlanSql, [
		JSON.stringify(validCheckpoints),
		historyArchiveSequentialPrefetchDepth
	])) as readonly {
		readonly planned: number | string;
		readonly ready?: number | string;
		readonly advanced?: number | string;
	}[];
	if (Number(result?.ready ?? 0) > 0 || Number(result?.advanced ?? 0) > 0)
		await notifyHistoryArchiveReadyWork(manager);
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
	return await materializeNextCompactCheckpointPlans(manager, [
		{
			archiveUrlIdentity,
			checkpointLedger: completedCheckpointLedger
		}
	]);
}

export const targetedCompactCheckpointPlanSql = `
	with completed as materialized (
		select distinct input."archiveUrlIdentity", input."checkpointLedger"
		from jsonb_to_recordset($1::jsonb) as input(
			"archiveUrlIdentity" text,
			"checkpointLedger" integer
		)
		where input."archiveUrlIdentity" <> ''
			and input."checkpointLedger" >= 63
	), verified_completed as materialized (
		select completed.*,
			min(completed."checkpointLedger") over (
				partition by completed."archiveUrlIdentity"
			) as "firstCheckpointLedger",
			row_number() over (
				partition by completed."archiveUrlIdentity"
				order by completed."checkpointLedger"
			) as sequence
		from completed
		where exists (
			select 1
			from "history_archive_checkpoint_proof" proof
			where proof."archiveUrlIdentity" = completed."archiveUrlIdentity"
				and proof."checkpointLedger" = completed."checkpointLedger"
				and proof.status = 'verified'
		) or exists (
			select 1
			from "history_archive_checkpoint_substitution" substitution
			where substitution."archiveUrlIdentity" =
					completed."archiveUrlIdentity"
				and substitution."checkpointLedger" =
					completed."checkpointLedger"
		)
	), contiguous_completed as materialized (
		select "archiveUrlIdentity",
			min("firstCheckpointLedger") as "firstCheckpointLedger",
			max("checkpointLedger") as "checkpointLedger"
		from verified_completed
		where "checkpointLedger" =
			"firstCheckpointLedger" + ((sequence - 1) * 64)
		group by "archiveUrlIdentity"
	), candidate as materialized (
		select cursor."archiveUrlIdentity",
			greatest(
				cursor."latestCheckpointLedger",
				(
					floor((state."currentLedger" + 1)::numeric / 64) * 64 - 1
				)::integer
			) as "latestCheckpointLedger",
			cursor."lastForwardCheckpointLedger",
			completed."checkpointLedger" + 64 as checkpoint_ledger,
			root."archiveUrl", root."hostIdentity"
		from contiguous_completed completed
		join "history_archive_checkpoint_scan_cursor" cursor
			on cursor."archiveUrlIdentity" =
				completed."archiveUrlIdentity"
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
		where cursor."nextHistoricalCheckpointLedger" =
				completed."firstCheckpointLedger" + 64
			and completed."checkpointLedger" + 64 <= greatest(
				cursor."latestCheckpointLedger",
				(
					floor((state."currentLedger" + 1)::numeric / 64) * 64 - 1
				)::integer
			)
		order by cursor."archiveUrlIdentity"
		for update of cursor
	), object_candidate as materialized (
		select candidate.*
		from candidate
		union
		select candidate."archiveUrlIdentity",
			candidate."latestCheckpointLedger",
			candidate."lastForwardCheckpointLedger",
			least(
				candidate."latestCheckpointLedger",
				candidate.checkpoint_ledger + (($2::integer - 1) * 64)
			)::integer as checkpoint_ledger,
			candidate."archiveUrl", candidate."hostIdentity"
		from candidate
		where candidate.checkpoint_ledger < candidate."latestCheckpointLedger"
	), source as materialized (
		select object_candidate.*,
			lpad(to_hex(object_candidate.checkpoint_ledger), 8, '0')
				as checkpoint_hex
		from object_candidate
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
		returning "remoteId", "archiveUrlIdentity",
			"checkpointLedger"
	), advanced as (
		update "history_archive_checkpoint_scan_cursor" cursor
		set "latestCheckpointLedger" = candidate."latestCheckpointLedger",
			"lastForwardCheckpointLedger" = case
				when candidate.checkpoint_ledger = candidate."latestCheckpointLedger"
					then candidate.checkpoint_ledger
				else cursor."lastForwardCheckpointLedger"
			end,
			"nextHistoricalCheckpointLedger" = candidate.checkpoint_ledger + 64,
			"updatedAt" = now()
		from candidate
		where cursor."archiveUrlIdentity" = candidate."archiveUrlIdentity"
		returning cursor."archiveUrlIdentity"
	), ready as (
		insert into "history_archive_object_ready" (
			"objectRemoteId", "archiveUrlIdentity", priority, "availableAt",
			"createdAt", "updatedAt"
		)
		select inserted."remoteId", inserted."archiveUrlIdentity", 2, now(),
			now(), now()
		from inserted
		join candidate
			on candidate."archiveUrlIdentity" = inserted."archiveUrlIdentity"
			and candidate.checkpoint_ledger = inserted."checkpointLedger"
		join advanced
			on advanced."archiveUrlIdentity" = inserted."archiveUrlIdentity"
		on conflict ("objectRemoteId") do nothing
		returning "objectRemoteId"
	)
	select (select count(*) from inserted)::integer as planned,
		(select count(*) from ready)::integer as ready,
		(select count(*) from advanced)::integer as advanced
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
	), substitution_candidates as materialized (
		select cursor."archiveUrlIdentity",
			failed."checkpointLedger", failed.id as failed_proof_id,
			source."archiveUrlIdentity" as source_archive_identity,
			source.id as source_proof_id
		from "history_archive_checkpoint_scan_cursor" cursor
		join "history_archive_checkpoint_proof" failed
			on failed."archiveUrlIdentity" = cursor."archiveUrlIdentity"
			and failed."checkpointLedger" =
				cursor."nextHistoricalCheckpointLedger" - 64
		join "history_archive_state_snapshot" target_state
			on target_state."archiveUrlIdentity" = cursor."archiveUrlIdentity"
			and target_state."networkPassphrase" is not null
		join lateral (
			select source_proof.id, source_proof."archiveUrlIdentity"
			from "history_archive_checkpoint_proof" source_proof
			join "history_archive_state_snapshot" source_state
				on source_state."archiveUrlIdentity" =
					source_proof."archiveUrlIdentity"
				and source_state.status = 'available'
				and source_state."networkPassphrase" =
					target_state."networkPassphrase"
			where source_proof."checkpointLedger" = failed."checkpointLedger"
				and source_proof."archiveUrlIdentity" <>
					failed."archiveUrlIdentity"
				and source_proof.status = 'verified'
				and source_proof."requiredObjectsComplete" = true
				and source_proof."proofFactsComplete" = true
				and source_proof."failureKind" is null
			order by case
				when source_proof."archiveUrlIdentity" = $4::text then 0
				else 1
			end, source_proof."evaluatedAt", source_proof.id
			limit 1
		) source on true
		where cursor."nextHistoricalCheckpointLedger" > 63
			and failed.status = 'not-evaluable'
			and failed."failureKind" = 'object-failed'
			and (
				failed.details->>'failureHttpStatus' in ('403', '404', '410')
				or exists (
					select 1
					from "history_archive_object_queue" failed_object
					where failed_object."archiveUrlIdentity" =
						failed."archiveUrlIdentity"
						and failed_object."checkpointLedger" =
							failed."checkpointLedger"
						and failed_object."objectType" in (
							'checkpoint-state', 'ledger', 'transactions', 'results'
						)
						and failed_object.status = 'failed'
						and failed_object."httpStatus" in (403, 404, 410)
						and coalesce(
							failed_object."failureChannel", 'archive_evidence'
						) in ('archive_evidence', 'archive_availability')
				)
				or exists (
					select 1
					from "history_archive_checkpoint_bucket_dependency" dependency
					join "history_archive_object_queue" failed_bucket
						on failed_bucket."archiveUrlIdentity" =
							dependency."archiveUrlIdentity"
						and failed_bucket."objectType" = 'bucket'
						and failed_bucket."bucketHash" = dependency."bucketHash"
						and failed_bucket.status = 'failed'
						and failed_bucket."httpStatus" in (403, 404, 410)
						and coalesce(
							failed_bucket."failureChannel", 'archive_evidence'
						) in ('archive_evidence', 'archive_availability')
					where dependency."archiveUrlIdentity" =
						failed."archiveUrlIdentity"
						and dependency."checkpointLedger" =
							failed."checkpointLedger"
				)
			)
	), substitutions as (
		insert into "history_archive_checkpoint_substitution" (
			"archiveUrlIdentity", "checkpointLedger",
			"failedCheckpointProofId", "sourceArchiveUrlIdentity",
			"sourceCheckpointProofId", reason
		)
		select candidate."archiveUrlIdentity", candidate."checkpointLedger",
			candidate.failed_proof_id, candidate.source_archive_identity,
			candidate.source_proof_id, 'remote-http-missing'
		from substitution_candidates candidate
		on conflict ("archiveUrlIdentity", "checkpointLedger") do nothing
		returning "archiveUrlIdentity", "checkpointLedger"
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
                        cursor."nextHistoricalCheckpointLedger"
                from "history_archive_checkpoint_scan_cursor" cursor
                join available_roots root
                        on root."archiveUrlIdentity" = cursor."archiveUrlIdentity"
                where cursor."nextHistoricalCheckpointLedger" is not null
				and (
					$3::text[] is null
					or cursor."archiveUrlIdentity" = any($3::text[])
				)
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
                                ) or exists (
                                        select 1
                                        from "history_archive_checkpoint_substitution" substitution
                                        where substitution."archiveUrlIdentity" =
                                                cursor."archiveUrlIdentity"
                                                and substitution."checkpointLedger" =
                                                        cursor."nextHistoricalCheckpointLedger" - 64
                                )
                        )
                order by cursor."nextHistoricalCheckpointLedger",
                        cursor."updatedAt",
                        cursor."archiveUrlIdentity"
                limit $1
                for update of cursor skip locked
	), cursor_targets as materialized (
		select candidate.*, target.checkpoint_ledger
		from cursor_candidates candidate
		cross join lateral (
			select coalesce(
				min(position.checkpoint_ledger) filter (
					where proof.status is distinct from 'verified'
				),
				max(position.checkpoint_ledger) + 64
			)::integer as checkpoint_ledger
			from generate_series(
				candidate."nextHistoricalCheckpointLedger",
				least(
					candidate."latestCheckpointLedger",
					candidate."nextHistoricalCheckpointLedger" +
						(($2::integer - 1) * 64)
				),
				64
			) position(checkpoint_ledger)
			left join "history_archive_checkpoint_proof" proof
				on proof."archiveUrlIdentity" = candidate."archiveUrlIdentity"
				and proof."checkpointLedger" = position.checkpoint_ledger
		) target
	), source as materialized (
		select candidate.*, root."archiveUrl", root."hostIdentity",
			lpad(to_hex(candidate.checkpoint_ledger), 8, '0') as checkpoint_hex
		from cursor_targets candidate
		join available_roots root
			on root."archiveUrlIdentity" = candidate."archiveUrlIdentity"
		where candidate.checkpoint_ledger between 63
			and candidate."latestCheckpointLedger"
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
				when candidate.checkpoint_ledger >=
					candidate."latestCheckpointLedger"
					then candidate."latestCheckpointLedger"
				else cursor."lastForwardCheckpointLedger"
			end,
                        "nextHistoricalCheckpointLedger" = case
				when candidate.checkpoint_ledger >
					candidate."latestCheckpointLedger"
					then candidate.checkpoint_ledger
				else candidate.checkpoint_ledger + 64
			end,
			"updatedAt" = now()
		from cursor_targets candidate
		where cursor."archiveUrlIdentity" = candidate."archiveUrlIdentity"
		returning cursor."archiveUrlIdentity"
	)
	select (select count(*) from inserted)::integer as planned,
		(select count(*) from advanced)::integer as advanced
`;
