import { setImmediate } from 'node:timers';
import type { Repository } from 'typeorm';
import type { HistoryArchiveObject } from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveObject.js';

interface SharedCheckpointContentRow {
	readonly archiveUrlIdentity: string;
	readonly bucketCount: number;
	readonly bucketHashes: readonly string[];
	readonly bucketListHash: string;
	readonly bucketSetDigest: string;
	readonly checkpointLedger: number;
	readonly contentDigest: string;
	readonly remoteId: string;
}

interface SharedCheckpointShadowQueue {
	flushing: boolean;
	readonly pendingRemoteIds: Set<string>;
	scheduled: boolean;
}

const shadowQueues = new WeakMap<
	Repository<HistoryArchiveObject>,
	SharedCheckpointShadowQueue
>();

export function enqueueHistoryArchiveSharedCheckpointContentShadow(
	repository: Repository<HistoryArchiveObject>,
	remoteIds: readonly string[]
): void {
	const queue = getShadowQueue(repository);
	for (const remoteId of remoteIds) {
		if (remoteId.length > 0) queue.pendingRemoteIds.add(remoteId);
	}
	scheduleShadowFlush(repository, queue);
}

export async function writeHistoryArchiveSharedCheckpointContentShadow(
	repository: Repository<HistoryArchiveObject>,
	remoteIds: readonly string[]
): Promise<void> {
	const uniqueRemoteIds = [...new Set(remoteIds)].filter(
		(remoteId) => remoteId.length > 0
	);
	if (uniqueRemoteIds.length === 0) return;

	await repository.manager.transaction(async (manager) => {
		await manager.query(`set local lock_timeout = '2s'`);
		await manager.query(`set local statement_timeout = '30s'`);
		const derived = (await manager.query(deriveSharedCheckpointContentSql, [
			uniqueRemoteIds
		])) as readonly SharedCheckpointContentRow[];
		if (derived.length === 0) return;

		const payload = JSON.stringify(derived);
		const insertedSets = (await manager.query(insertSharedBucketSetsSql, [
			payload
		])) as readonly { readonly bucketSetDigest: string }[];
		if (insertedSets.length > 0) {
			await manager.query(insertSharedBucketSetMembersSql, [
				payload,
				insertedSets.map((row) => row.bucketSetDigest)
			]);
		}
		await manager.query(insertSharedCheckpointContentSql, [payload]);
		await manager.query(insertSharedCheckpointObservationsSql, [payload]);
		await manager.query(recordSharedCheckpointConflictsSql, [payload]);
	});
}

function getShadowQueue(
	repository: Repository<HistoryArchiveObject>
): SharedCheckpointShadowQueue {
	const existing = shadowQueues.get(repository);
	if (existing !== undefined) return existing;
	const created: SharedCheckpointShadowQueue = {
		flushing: false,
		pendingRemoteIds: new Set<string>(),
		scheduled: false
	};
	shadowQueues.set(repository, created);
	return created;
}

function scheduleShadowFlush(
	repository: Repository<HistoryArchiveObject>,
	queue: SharedCheckpointShadowQueue
): void {
	if (queue.scheduled || queue.flushing || queue.pendingRemoteIds.size === 0) {
		return;
	}
	queue.scheduled = true;
	setImmediate(() => {
		queue.scheduled = false;
		void flushShadowQueue(repository, queue);
	});
}

async function flushShadowQueue(
	repository: Repository<HistoryArchiveObject>,
	queue: SharedCheckpointShadowQueue
): Promise<void> {
	if (queue.flushing || queue.pendingRemoteIds.size === 0) return;
	queue.flushing = true;
	const remoteIds = [...queue.pendingRemoteIds];
	queue.pendingRemoteIds.clear();
	try {
		await writeHistoryArchiveSharedCheckpointContentShadow(
			repository,
			remoteIds
		);
	} catch (error) {
		console.error(
			'History archive shared checkpoint shadow write failed; legacy dependency data remains authoritative',
			error
		);
	} finally {
		queue.flushing = false;
		scheduleShadowFlush(repository, queue);
	}
}

const deriveSharedCheckpointContentSql = `
	with checkpoint as materialized (
		select object."remoteId", object."archiveUrlIdentity",
			object."checkpointLedger", object."verificationFacts"
		from "history_archive_object_queue" object
		where object."remoteId" = any($1::uuid[])
			and object."objectType" = 'checkpoint-state'
			and object.status = 'verified'
			and object."checkpointLedger" is not null
	), hashes as materialized (
		select distinct checkpoint."remoteId",
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
	)
	select checkpoint."remoteId", checkpoint."archiveUrlIdentity",
		checkpoint."checkpointLedger",
		lower(checkpoint."verificationFacts"#>>'{content,digest}')
			as "contentDigest",
		checkpoint."verificationFacts"#>>
			'{checkpointHistoryArchiveStateFact,bucketListHash}'
			as "bucketListHash",
		count(hashes."bucketHash")::integer as "bucketCount",
		encode(
			sha256(
				convert_to(
					string_agg(
						hashes."bucketHash",
						',' order by hashes."bucketHash"
					),
					'UTF8'
				)
			),
			'hex'
		) as "bucketSetDigest",
		array_agg(hashes."bucketHash" order by hashes."bucketHash")
			as "bucketHashes"
	from checkpoint
	join hashes on hashes."remoteId" = checkpoint."remoteId"
	where lower(checkpoint."verificationFacts"#>>'{content,digest}')
			~ '^[0-9a-f]{64}$'
		and length(coalesce(
			checkpoint."verificationFacts"#>>
				'{checkpointHistoryArchiveStateFact,bucketListHash}',
			''
		)) > 0
	group by checkpoint."remoteId", checkpoint."archiveUrlIdentity",
		checkpoint."checkpointLedger",
		checkpoint."verificationFacts"#>>'{content,digest}',
		checkpoint."verificationFacts"#>>
			'{checkpointHistoryArchiveStateFact,bucketListHash}'
	order by checkpoint."remoteId"
`;

const insertSharedBucketSetsSql = `
	insert into "history_archive_checkpoint_bucket_set" (
		"bucketSetDigest", "bucketCount"
	)
	select distinct on (derived."bucketSetDigest")
		derived."bucketSetDigest", derived."bucketCount"
	from jsonb_to_recordset($1::jsonb) as derived(
		"bucketSetDigest" text,
		"bucketCount" integer
	)
	order by derived."bucketSetDigest", derived."bucketCount"
	on conflict ("bucketSetDigest") do nothing
	returning "bucketSetDigest"
`;

const insertSharedBucketSetMembersSql = `
	insert into "history_archive_checkpoint_bucket_set_member" (
		"bucketSetDigest", "bucketHash"
	)
	select distinct derived."bucketSetDigest", lower(member.value)
	from jsonb_to_recordset($1::jsonb) as derived(
		"bucketSetDigest" text,
		"bucketHashes" jsonb
	)
	cross join lateral jsonb_array_elements_text(
		derived."bucketHashes"
	) member(value)
	where derived."bucketSetDigest" = any($2::text[])
	order by derived."bucketSetDigest", lower(member.value)
	on conflict ("bucketSetDigest", "bucketHash") do nothing
`;

const insertSharedCheckpointContentSql = `
	insert into "history_archive_checkpoint_content" (
		"contentDigest", "checkpointLedger", "bucketListHash",
		"bucketSetDigest"
	)
	select distinct on (derived."contentDigest")
		derived."contentDigest", derived."checkpointLedger",
		derived."bucketListHash", derived."bucketSetDigest"
	from jsonb_to_recordset($1::jsonb) as derived(
		"contentDigest" text,
		"checkpointLedger" integer,
		"bucketListHash" text,
		"bucketSetDigest" text,
		"bucketCount" integer
	)
	join "history_archive_checkpoint_bucket_set" stored_set
		on stored_set."bucketSetDigest" = derived."bucketSetDigest"
		and stored_set."bucketCount" = derived."bucketCount"
	order by derived."contentDigest", derived."checkpointLedger",
		derived."bucketSetDigest"
	on conflict ("contentDigest") do nothing
`;

const insertSharedCheckpointObservationsSql = `
	insert into "history_archive_checkpoint_content_observation" (
		"archiveUrlIdentity", "checkpointLedger", "contentDigest",
		"checkpointStateObjectRemoteId"
	)
	select derived."archiveUrlIdentity", derived."checkpointLedger",
		derived."contentDigest", derived."remoteId"::uuid
	from jsonb_to_recordset($1::jsonb) as derived(
		"remoteId" text,
		"archiveUrlIdentity" text,
		"checkpointLedger" integer,
		"contentDigest" text,
		"bucketListHash" text,
		"bucketSetDigest" text
	)
	join "history_archive_checkpoint_content" content
		on content."contentDigest" = derived."contentDigest"
		and content."checkpointLedger" = derived."checkpointLedger"
		and content."bucketListHash" = derived."bucketListHash"
		and content."bucketSetDigest" = derived."bucketSetDigest"
	order by derived."archiveUrlIdentity", derived."checkpointLedger"
	on conflict ("archiveUrlIdentity", "checkpointLedger") do nothing
`;

const recordSharedCheckpointConflictsSql = `
	insert into "history_archive_checkpoint_content_conflict" (
		"archiveUrlIdentity", "checkpointLedger",
		"checkpointStateObjectRemoteId", "observedContentDigest",
		"observedBucketListHash", "observedBucketSetDigest",
		"observedBucketCount", "storedContentDigest",
		"storedBucketListHash", "storedBucketSetDigest",
		"storedBucketCount", "observedAt"
	)
	select derived."archiveUrlIdentity", derived."checkpointLedger",
		derived."remoteId"::uuid, derived."contentDigest",
		derived."bucketListHash", derived."bucketSetDigest",
		derived."bucketCount", content."contentDigest",
		content."bucketListHash", content."bucketSetDigest",
		stored_set."bucketCount", now()
	from jsonb_to_recordset($1::jsonb) as derived(
		"remoteId" text,
		"archiveUrlIdentity" text,
		"checkpointLedger" integer,
		"contentDigest" text,
		"bucketListHash" text,
		"bucketSetDigest" text,
		"bucketCount" integer
	)
	left join "history_archive_checkpoint_bucket_set" stored_set
		on stored_set."bucketSetDigest" = derived."bucketSetDigest"
	left join "history_archive_checkpoint_content" content
		on content."contentDigest" = derived."contentDigest"
	left join "history_archive_checkpoint_content_observation" observation
		on observation."archiveUrlIdentity" =
			derived."archiveUrlIdentity"
		and observation."checkpointLedger" =
			derived."checkpointLedger"
	where stored_set."bucketCount" is distinct from derived."bucketCount"
		or content."contentDigest" is null
		or content."checkpointLedger"
			is distinct from derived."checkpointLedger"
		or content."bucketListHash"
			is distinct from derived."bucketListHash"
		or content."bucketSetDigest"
			is distinct from derived."bucketSetDigest"
		or observation."contentDigest"
			is distinct from derived."contentDigest"
	on conflict ("archiveUrlIdentity", "checkpointLedger") do update
	set "checkpointStateObjectRemoteId" =
			excluded."checkpointStateObjectRemoteId",
		"observedContentDigest" = excluded."observedContentDigest",
		"observedBucketListHash" = excluded."observedBucketListHash",
		"observedBucketSetDigest" = excluded."observedBucketSetDigest",
		"observedBucketCount" = excluded."observedBucketCount",
		"storedContentDigest" = excluded."storedContentDigest",
		"storedBucketListHash" = excluded."storedBucketListHash",
		"storedBucketSetDigest" = excluded."storedBucketSetDigest",
		"storedBucketCount" = excluded."storedBucketCount",
		"observedAt" = excluded."observedAt"
`;
