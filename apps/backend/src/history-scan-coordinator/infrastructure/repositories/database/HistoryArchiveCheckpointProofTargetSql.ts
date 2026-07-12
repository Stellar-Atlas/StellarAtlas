export const historyArchiveImmediateBucketProofRefreshLimit = 1;

export const historyArchiveCheckpointProofTargetCtesSql = `
	bucket_requested_checkpoints as materialized (
		select dependency."archiveUrlIdentity", dependency."checkpointLedger"
		from "history_archive_checkpoint_bucket_dependency" dependency
		left join "history_archive_state_snapshot" state
			on state."archiveUrlIdentity" = dependency."archiveUrlIdentity"
		left join "full_history_promotion_runtime" runtime
			on runtime.state in ('promoting', 'waiting-for-proof')
			and runtime."checkpoint_ledger" = dependency."checkpointLedger"
			and state."networkPassphrase" is not null
			and sha256(convert_to(state."networkPassphrase", 'UTF8')) =
				runtime."network_passphrase_hash"
		where dependency."archiveUrlIdentity" = $1::text
			and $3::text is not null
			and dependency."bucketHash" = lower($3::text)
		order by
			case when runtime."network_passphrase_hash" is not null then 0 else 1 end,
			dependency."checkpointLedger" desc
		limit ${historyArchiveImmediateBucketProofRefreshLimit}
	), requested_checkpoints as (
		select $1::text as "archiveUrlIdentity", ledger as "checkpointLedger"
		from (values
			($2::integer),
			(case when $2::integer <= 2147483583 then $2::integer + 64 end)
		) requested(ledger)
		where ledger is not null
		union
		select * from bucket_requested_checkpoints
	), target_checkpoints as (
		select requested.*
		from requested_checkpoints requested
		where exists (
			select 1 from "history_archive_object_queue" object
			where object."archiveUrlIdentity" = requested."archiveUrlIdentity"
				and object."checkpointLedger" = requested."checkpointLedger"
		)
	), expected_checkpoint_ranges as (
		select
			target.*,
			(case when target."checkpointLedger" = 63
				then 1 else target."checkpointLedger" - 63 end)::bigint
				as first_expected_ledger,
			target."checkpointLedger"::bigint as last_expected_ledger,
			(case when target."checkpointLedger" = 63 then 63 else 64 end)::bigint
				as expected_ledger_count
		from target_checkpoints target
	)
`;
