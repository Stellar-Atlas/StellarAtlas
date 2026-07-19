export const knownArchiveEvidenceRootSql = `
	with requested_roots as (
		select *
		from unnest($1::text[], $2::text[])
			as root("archiveUrl", "archiveUrlIdentity")
	), summary_progress as materialized (
		select
			coalesce((
				select "complete" and "lastObjectId" = "cutoffObjectId"
				from history_archive_evidence_root_summary_progress
				where id = 1
			), false)
			and coalesce((
				select "complete" and "lastProofId" = "cutoffProofId"
				from history_archive_checkpoint_proof_rollup_progress
				where id = 1
			), false) as "rollupComplete"
	)
	select
		root."archiveUrl",
		root."archiveUrlIdentity",
		summary_progress."rollupComplete",
		coalesce(summary."totalObjects", 0) as "totalObjects",
		coalesce(summary."pendingObjects", 0) as "pendingObjects",
		coalesce(summary."activeObjects", 0) as "activeObjects",
		coalesce(summary."verifiedObjects", 0) as "verifiedObjects",
		coalesce(summary."remoteFailureObjects", 0) as "remoteFailureObjects",
		coalesce(summary."workerIssueObjects", 0) as "workerIssueObjects",
		coalesce(summary."bucketObjects", 0) as "bucketObjects",
		coalesce(summary."verifiedBucketObjects", 0) as "verifiedBucketObjects",
		coalesce(proof."totalCheckpointProofs", 0) as "totalCheckpoints",
		coalesce(proof."verifiedCheckpointProofs", 0) as "verifiedCheckpoints",
		coalesce(proof."mismatchCheckpointProofs", 0)
			as "mismatchedCheckpoints",
		coalesce(proof."pendingCheckpointProofs", 0) as "pendingCheckpoints",
		coalesce(proof."notEvaluableCheckpointProofs", 0)
			as "notEvaluableCheckpoints"
	from requested_roots root
	cross join summary_progress
	left join history_archive_evidence_root_summary summary
		on summary."archiveUrlIdentity" = root."archiveUrlIdentity"
	left join history_archive_checkpoint_proof_rollup proof
		on proof."archiveUrlIdentity" = root."archiveUrlIdentity"
	order by root."archiveUrlIdentity" asc
`;

export const knownArchiveEvidenceFutureObjectSql = `
	select
		archive_object."archiveUrlIdentity",
		count(*) as "totalObjects",
		count(*) filter (where archive_object.status = 'pending')
			as "pendingObjects",
		count(*) filter (where archive_object.status = 'scanning')
			as "activeObjects",
		count(*) filter (where archive_object.status = 'verified')
			as "verifiedObjects",
		count(*) filter (
			where archive_object.status = 'failed'
				and archive_object."failureChannel" = 'archive_evidence'
		) as "remoteFailureObjects",
		count(*) filter (
			where archive_object.status = 'failed'
				and archive_object."failureChannel" = 'scanner_issue'
		) as "workerIssueObjects",
		count(*) filter (where archive_object."objectType" = 'bucket')
			as "bucketObjects",
		count(*) filter (
			where archive_object."objectType" = 'bucket'
				and archive_object.status = 'verified'
		) as "verifiedBucketObjects"
	from history_archive_object_queue archive_object
	where archive_object."archiveUrlIdentity" = any($1::text[])
		and archive_object."createdAt" > $2::timestamptz
	group by archive_object."archiveUrlIdentity"
`;

export const knownArchiveEvidenceFutureCheckpointSql = `
	select
		proof."archiveUrlIdentity",
		count(*) as "totalCheckpoints",
		count(*) filter (where proof.status = 'verified')
			as "verifiedCheckpoints",
		count(*) filter (where proof.status = 'mismatch')
			as "mismatchedCheckpoints",
		count(*) filter (where proof.status = 'pending')
			as "pendingCheckpoints",
		count(*) filter (where proof.status = 'not-evaluable')
			as "notEvaluableCheckpoints"
	from history_archive_checkpoint_proof proof
	where proof."archiveUrlIdentity" = any($1::text[])
		and proof."createdAt" > $2::timestamptz
	group by proof."archiveUrlIdentity"
`;

export const knownArchiveEvidenceLatestObjectSql = `
	select root."archiveUrlIdentity", latest."createdAt" as "latestObjectAt"
	from unnest($1::text[]) as root("archiveUrlIdentity")
	left join lateral (
		select archive_object."createdAt"
		from history_archive_object_queue archive_object
		where archive_object."archiveUrlIdentity" = root."archiveUrlIdentity"
			and archive_object."createdAt" <= $2::timestamptz
		order by archive_object."createdAt" desc
		limit 1
	) latest on true
`;
