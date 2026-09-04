import { canonicalRuntimeTargetCtes } from './HistoryArchiveCanonicalRuntimeTargetSql.js';
import { historyArchiveCheckpointBucketDependenciesSql } from './HistoryArchiveCheckpointDependencyReadSql.js';

export const historyArchiveImmediateBucketProofRefreshLimit = 2;

export const historyArchiveCheckpointProofTargetCtesSql = `
	${canonicalRuntimeTargetCtes}, bucket_candidate_checkpoints as materialized (
		select state."archiveUrlIdentity", runtime.checkpoint_ledger
			as "checkpointLedger", runtime.target_lane
		from "history_archive_state_snapshot" state
		join runtime_target runtime
			on state."networkPassphrase" is not null
			and sha256(convert_to(state."networkPassphrase", 'UTF8')) =
				runtime."network_passphrase_hash"
		where state."archiveUrlIdentity" = $1::text
		union
		select chain_cursor."archiveUrlIdentity",
			chain_cursor."nextHistoricalCheckpointLedger" - 64,
			'sequential'::text
		from "history_archive_checkpoint_scan_cursor" chain_cursor
		where chain_cursor."archiveUrlIdentity" = $1::text
	), bucket_requested_checkpoints as materialized (
		select candidate."archiveUrlIdentity", candidate."checkpointLedger"
		from bucket_candidate_checkpoints candidate
		cross join lateral (
			${historyArchiveCheckpointBucketDependenciesSql(
				'candidate."archiveUrlIdentity"',
				'candidate."checkpointLedger"'
			)}
		) dependency
		where $3::text is not null
			and dependency."bucketHash" = lower($3::text)
		order by
			case candidate.target_lane
				when 'forward' then 0
				when 'historical' then 1
				else 2
			end,
			candidate."checkpointLedger" desc
		limit ${historyArchiveImmediateBucketProofRefreshLimit}
	), requested_checkpoints as (
		select $1::text as "archiveUrlIdentity", ledger as "checkpointLedger"
		from (values
			($2::integer),
			(case when $4::boolean and $2::integer <= 2147483583
				then $2::integer + 64 end)
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
export const historyArchiveCheckpointProofBatchTargetCtesSql = `
	input_targets as materialized (
		select target."archiveUrlIdentity",
			target."checkpointLedger",
			target."evidenceUpdatedAt",
			target.generation,
			target."leaseToken"
		from jsonb_to_recordset($1::jsonb) as target(
			"archiveUrlIdentity" text,
			"checkpointLedger" integer,
			"evidenceUpdatedAt" timestamptz,
			generation bigint,
			"leaseToken" uuid
		)
	), locked_targets as materialized (
		select target.*
		from input_targets target
		join "history_archive_checkpoint_proof_refresh_queue" queue
			on queue."archiveUrlIdentity" = target."archiveUrlIdentity"
			and queue."checkpointLedger" = target."checkpointLedger"
			and queue."leaseToken" = target."leaseToken"
			and queue.generation = target.generation
			and queue."evidenceUpdatedAt" =
				target."evidenceUpdatedAt"
		where queue."leaseUntil" > now()
		order by target."archiveUrlIdentity", target."checkpointLedger"
		for update of queue
	), requested_checkpoints as materialized (
		select target."archiveUrlIdentity", target."checkpointLedger"
		from locked_targets target
	), target_checkpoints as materialized (
		select requested.*
		from requested_checkpoints requested
		where exists (
			select 1
			from "history_archive_object_queue" object
			where object."archiveUrlIdentity" =
				requested."archiveUrlIdentity"
				and object."checkpointLedger" =
					requested."checkpointLedger"
		)
	), expected_checkpoint_ranges as materialized (
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
