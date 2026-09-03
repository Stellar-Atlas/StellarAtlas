import type { Repository } from 'typeorm';
import type { HistoryArchiveObject } from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveObject.js';
import { lockHistoryArchiveObjectRootTransitions } from './HistoryArchiveRootTransitionLock.js';

export async function materializeHistoryArchiveCheckpointDependencies(
	repository: Repository<HistoryArchiveObject>,
	remoteId: string
): Promise<number> {
	return await materializeHistoryArchiveCheckpointDependencyBatch(repository, [
		remoteId
	]);
}

export async function materializeHistoryArchiveCheckpointDependencyBatch(
	repository: Repository<HistoryArchiveObject>,
	remoteIds: readonly string[]
): Promise<number> {
	const uniqueRemoteIds = [...new Set(remoteIds)].filter(
		(remoteId) => remoteId.length > 0
	);
	if (uniqueRemoteIds.length === 0) return 0;
	return await repository.manager.transaction(async (manager) => {
		await lockHistoryArchiveObjectRootTransitions(manager, uniqueRemoteIds);
		await manager.query(`set local lock_timeout = '2s'`);
		await manager.query(`set local statement_timeout = '30s'`);
		const inserted = (await manager.query(materializeDependenciesSql, [
			uniqueRemoteIds
		])) as readonly unknown[];
		await manager.query(activateCheckpointCategoryDependenciesSql, [
			uniqueRemoteIds
		]);
		await manager.query(activateCheckpointBucketDependenciesSql, [
			uniqueRemoteIds
		]);
		return inserted.length;
	});
}

export async function reconcileHistoryArchiveDependencyReadiness(
	repository: Repository<HistoryArchiveObject>,
	limit: number
): Promise<number> {
	const [row] = (await repository.manager.query(reconcileReadinessSql, [
		normalizeLimit(limit)
	])) as readonly { readonly count: number | string }[];
	return Number(row?.count ?? 0);
}

function normalizeLimit(limit: number): number {
	if (!Number.isSafeInteger(limit) || limit < 1) return 256;
	return Math.min(limit, 2000);
}

const materializeDependenciesSql = `
	with checkpoint as materialized (
		select *
		from "history_archive_object_queue"
                where "remoteId" = any($1::uuid[])
			and "objectType" = 'checkpoint-state'
			and status = 'verified'
		order by "remoteId"
		for update skip locked
	), hashes as (
                select distinct checkpoint."remoteId",
                        checkpoint."archiveUrlIdentity",
                        checkpoint."checkpointLedger",
                        lower(hash.value) as "bucketHash"
		from checkpoint
		cross join lateral jsonb_array_elements(
			coalesce(
				checkpoint."verificationFacts"
					->'checkpointHistoryArchiveState'
					->'stellarHistory'
					->'currentBuckets',
				'[]'::jsonb
			)
			|| coalesce(
				checkpoint."verificationFacts"
					->'checkpointHistoryArchiveState'
					->'stellarHistory'
					->'hotArchiveBuckets',
				'[]'::jsonb
			)
		) bucket
		cross join lateral (
			values (bucket->>'curr'), (bucket->>'snap'),
				(bucket->'next'->>'output')
		) hash(value)
		where hash.value is not null
			and lower(hash.value) ~ '^[0-9a-f]{64}$'
			and lower(hash.value) !~ '^0+$'
	), inserted as (
		insert into "history_archive_checkpoint_bucket_dependency" (
			"archiveUrlIdentity", "checkpointLedger", "bucketHash"
		)
                select hashes."archiveUrlIdentity", hashes."checkpointLedger",
			hashes."bucketHash"
                from hashes
		on conflict do nothing
		returning "bucketHash"
	), marked as (
		update "history_archive_object_queue" object
		set "dependenciesMaterializedAt" = now()
		from checkpoint
		where object."remoteId" = checkpoint."remoteId"
			and object.status = 'verified'
			and (
				object."dependenciesMaterializedAt" is null
				or exists (select 1 from inserted)
			)
		returning object.id
	)
	select "bucketHash" from inserted
`;

const checkpointIdentitySql = `
	select "archiveUrlIdentity", "checkpointLedger"
	from "history_archive_object_queue"
        where "remoteId" = any($1::uuid[])
		and "objectType" = 'checkpoint-state'
		and status = 'verified'
`;

const activateCheckpointCategoryDependenciesSql = `
	with checkpoint as (
		${checkpointIdentitySql}
	)
	update "history_archive_object_queue" candidate
	set "dependencyReady" = true
	from checkpoint
	where candidate."archiveUrlIdentity" = checkpoint."archiveUrlIdentity"
		and candidate."dependencyReady" is distinct from true
		and candidate."objectType" in ('ledger', 'transactions', 'results', 'scp')
		and candidate."checkpointLedger" = checkpoint."checkpointLedger"
`;

const activateCheckpointBucketDependenciesSql = `
	with checkpoint as (
		${checkpointIdentitySql}
	), dependencies as materialized (
		select dependency."archiveUrlIdentity", dependency."bucketHash"
		from checkpoint
		join "history_archive_checkpoint_bucket_dependency" dependency
			on dependency."archiveUrlIdentity" = checkpoint."archiveUrlIdentity"
			and dependency."checkpointLedger" = checkpoint."checkpointLedger"
	)
	update "history_archive_object_queue" candidate
	set "dependencyReady" = true
	from dependencies dependency
	where candidate."archiveUrlIdentity" = dependency."archiveUrlIdentity"
		and candidate."objectType" = 'bucket'
		and candidate."bucketHash" = dependency."bucketHash"
		and candidate."dependencyReady" is distinct from true
`;

const reconcileReadinessSql = `
	with candidates as (
		select candidate.id
		from "history_archive_object_queue" candidate
		where candidate."dependencyReady" is null
			and candidate."executionDisposition" = 'executable'
			and candidate.status = 'pending'
		order by candidate.id
		for update skip locked
		limit $1
	), updated as (
		update "history_archive_object_queue" candidate
		set "dependencyReady" = case
			when candidate."objectType" = 'history-archive-state' then true
			when candidate."objectType" = 'checkpoint-state' then exists (
				select 1 from "history_archive_object_queue" dependency
				where dependency."archiveUrlIdentity" = candidate."archiveUrlIdentity"
					and dependency."objectType" = 'history-archive-state'
					and dependency."objectKey" = 'root'
					and dependency.status = 'verified'
			)
			when candidate."objectType" in ('ledger', 'transactions', 'results', 'scp')
				then exists (
					select 1 from "history_archive_object_queue" dependency
					where dependency."archiveUrlIdentity" = candidate."archiveUrlIdentity"
						and dependency."objectType" = 'checkpoint-state'
						and dependency."checkpointLedger" = candidate."checkpointLedger"
						and dependency.status = 'verified'
				)
			else exists (
				select 1
				from "history_archive_checkpoint_bucket_dependency" dependency
				join "history_archive_object_queue" checkpoint
					on checkpoint."archiveUrlIdentity" = dependency."archiveUrlIdentity"
					and checkpoint."checkpointLedger" = dependency."checkpointLedger"
					and checkpoint."objectType" = 'checkpoint-state'
					and checkpoint.status = 'verified'
				where dependency."archiveUrlIdentity" = candidate."archiveUrlIdentity"
					and dependency."bucketHash" = candidate."bucketHash"
			)
		end
		from candidates
		where candidate.id = candidates.id
		returning candidate.id
	)
	select count(*)::integer as count from updated
`;
