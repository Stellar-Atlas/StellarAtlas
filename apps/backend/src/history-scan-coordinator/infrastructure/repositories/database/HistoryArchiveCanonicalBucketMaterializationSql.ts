export const canonicalBucketMaterializationCteSql = `
bucket_targets as materialized (
	select checkpoint."archiveUrl", checkpoint."archiveUrlIdentity",
		checkpoint."hostIdentity", hash."bucketHash"
	from hashes hash
	join checkpoints checkpoint
		on checkpoint."archiveUrlIdentity" = hash."archiveUrlIdentity"
		and checkpoint."checkpointLedger" = hash."checkpointLedger"
), inserted_buckets as (
	insert into "history_archive_object_queue" (
		"remoteId", "archiveUrl", "archiveUrlIdentity", "hostIdentity",
		"objectType", "objectKey", "objectOrder", "objectUrl",
		status, "checkpointLedger", "bucketHash", "dependencyReady",
		"executionDisposition", "executionReason",
		"executionDispositionAt", "createdAt", "updatedAt"
	)
	select gen_random_uuid(), target."archiveUrl", target."archiveUrlIdentity",
		target."hostIdentity", 'bucket', 'bucket:' || target."bucketHash", 50,
		rtrim(target."archiveUrl", '/') || '/bucket/' ||
			substring(target."bucketHash" from 1 for 2) || '/' ||
			substring(target."bucketHash" from 3 for 2) || '/' ||
			substring(target."bucketHash" from 5 for 2) || '/' ||
			'bucket-' || target."bucketHash" || '.xdr.gz',
		'pending', null, target."bucketHash", true, 'deferred',
		'canonical-frontier-materialization', now(), now(), now()
	from bucket_targets target
	where not exists (
		select 1
		from "history_archive_object_queue" existing
		where existing."archiveUrlIdentity" = target."archiveUrlIdentity"
			and existing."objectType" = 'bucket'
			and existing."objectKey" = 'bucket:' || target."bucketHash"
	)
	on conflict ("archiveUrlIdentity", "objectType", "objectKey")
		do nothing
	returning id
)
`;
