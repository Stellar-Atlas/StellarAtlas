export const markBucketProofDependentsDirtySql = `
	with dependents as materialized (
		select dependency."archiveUrlIdentity", dependency."checkpointLedger"
		from "history_archive_checkpoint_bucket_dependency" dependency
		where dependency."archiveUrlIdentity" = $1::text
			and dependency."bucketHash" = lower($2::text)
	), updated as (
		update "history_archive_object_queue" checkpoint
		set "dependenciesMaterializedAt" = now()
		from dependents dependency
		where checkpoint."archiveUrlIdentity" = dependency."archiveUrlIdentity"
			and checkpoint."checkpointLedger" = dependency."checkpointLedger"
			and checkpoint."objectType" = 'checkpoint-state'
			and checkpoint.status = 'verified'
		returning checkpoint.id
	)
	select count(*)::integer as count from updated
`;
