export function historyArchiveCheckpointBucketDependenciesSql(
	archiveUrlIdentitySql: string,
	checkpointLedgerSql: string
): string {
	return `
		with observed_checkpoint as materialized (
			select observation."archiveUrlIdentity",
				observation."checkpointLedger",
				observation."contentDigest",
				observation."checkpointStateObjectRemoteId",
				observation."createdAt"
			from "history_archive_checkpoint_content_observation" observation
			where observation."archiveUrlIdentity" =
				${archiveUrlIdentitySql}
				and observation."checkpointLedger" =
					${checkpointLedgerSql}
		), shared_dependency as (
			select observation."archiveUrlIdentity",
				observation."checkpointLedger", member."bucketHash",
				coalesce(
					checkpoint."dependenciesMaterializedAt",
					checkpoint."verifiedAt",
					observation."createdAt"
				) as "createdAt"
			from observed_checkpoint observation
			join "history_archive_checkpoint_content" content
				on content."contentDigest" =
					observation."contentDigest"
			join "history_archive_checkpoint_bucket_set_member" member
				on member."bucketSetDigest" =
					content."bucketSetDigest"
			left join "history_archive_object_queue" checkpoint
				on checkpoint."remoteId" =
					observation."checkpointStateObjectRemoteId"
		)
		select shared_dependency.*
		from shared_dependency
		union all
		select legacy."archiveUrlIdentity", legacy."checkpointLedger",
			legacy."bucketHash", legacy."createdAt"
		from "history_archive_checkpoint_bucket_dependency" legacy
		where legacy."archiveUrlIdentity" = ${archiveUrlIdentitySql}
			and legacy."checkpointLedger" = ${checkpointLedgerSql}
			and not exists (select 1 from observed_checkpoint)
	`;
}

export function historyArchiveCheckpointBucketDependencyRangeSql(
	archiveUrlIdentitySql: string,
	firstCheckpointLedgerSql: string,
	lastCheckpointLedgerSql: string
): string {
	return `
		with observed_checkpoints as materialized (
			select observation."archiveUrlIdentity",
				observation."checkpointLedger",
				observation."contentDigest",
				observation."checkpointStateObjectRemoteId",
				observation."createdAt"
			from "history_archive_checkpoint_content_observation" observation
			where observation."archiveUrlIdentity" =
				${archiveUrlIdentitySql}
				and observation."checkpointLedger" between
					${firstCheckpointLedgerSql}
					and ${lastCheckpointLedgerSql}
		)
		select observation."archiveUrlIdentity",
			observation."checkpointLedger", member."bucketHash",
			coalesce(
				checkpoint."dependenciesMaterializedAt",
				checkpoint."verifiedAt",
				observation."createdAt"
			) as "createdAt"
		from observed_checkpoints observation
		join "history_archive_checkpoint_content" content
			on content."contentDigest" = observation."contentDigest"
		join "history_archive_checkpoint_bucket_set_member" member
			on member."bucketSetDigest" = content."bucketSetDigest"
		left join "history_archive_object_queue" checkpoint
			on checkpoint."remoteId" =
				observation."checkpointStateObjectRemoteId"
		union all
		select legacy."archiveUrlIdentity", legacy."checkpointLedger",
			legacy."bucketHash", legacy."createdAt"
		from "history_archive_checkpoint_bucket_dependency" legacy
		where legacy."archiveUrlIdentity" = ${archiveUrlIdentitySql}
			and legacy."checkpointLedger" between
				${firstCheckpointLedgerSql}
				and ${lastCheckpointLedgerSql}
			and not exists (
				select 1
				from observed_checkpoints observation
				where observation."checkpointLedger" =
					legacy."checkpointLedger"
			)
	`;
}
