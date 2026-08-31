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
		coalesce(durable_proof."durableVerifiedCheckpointProofs", 0)
			as "verifiedCheckpoints",
		coalesce(proof."mismatchCheckpointProofs", 0)
			as "mismatchedCheckpoints",
		coalesce(proof."pendingCheckpointProofs", 0) as "pendingCheckpoints",
		coalesce(proof."notEvaluableCheckpointProofs", 0)
			as "notEvaluableCheckpoints",
		advertised."latestCheckpointLedger" as "advertisedLatestCheckpointLedger",
		case
			when frontier.status in ('mismatch', 'not-evaluable')
				and frontier."checkpointLedger" <= advertised."latestCheckpointLedger"
				then frontier."checkpointLedger"
			else null
		end as "blockedCheckpointLedger",
		coverage."lastContinuouslyVerifiedCheckpointLedger",
		case
			when frontier.status in ('mismatch', 'not-evaluable')
				and frontier."checkpointLedger" <= advertised."latestCheckpointLedger"
				then frontier."checkpointLedger"
			else cursor."nextHistoricalCheckpointLedger"
		end as "nextCheckpointLedger",
		case
			when state.status is distinct from 'available'
				or advertised."latestCheckpointLedger" is null then 'unavailable'
			when coverage."lastContinuouslyVerifiedCheckpointLedger" >=
				advertised."latestCheckpointLedger" then 'caught-up'
			when frontier.status in ('mismatch', 'not-evaluable')
				and frontier."checkpointLedger" <= advertised."latestCheckpointLedger"
				then 'blocked'
			else 'advancing'
		end as "sequentialCoverageStatus",
		blocker."objectType" as "blockerObjectType",
		blocker."objectUrl" as "blockerObjectUrl",
		blocker."httpStatus" as "blockerHttpStatus",
		blocker."errorType" as "blockerErrorType",
		blocker."updatedAt" as "blockerObservedAt"
	from requested_roots root
	cross join summary_progress
	left join history_archive_evidence_root_summary summary
		on summary."archiveUrlIdentity" = root."archiveUrlIdentity"
	left join history_archive_checkpoint_proof_rollup proof
		on proof."archiveUrlIdentity" = root."archiveUrlIdentity"
	left join history_archive_checkpoint_proof_attestation_rollup durable_proof
		on durable_proof."archiveUrlIdentity" = root."archiveUrlIdentity"
	left join history_archive_state_snapshot state
		on state."archiveUrlIdentity" = root."archiveUrlIdentity"
	left join history_archive_checkpoint_scan_cursor cursor
		on cursor."archiveUrlIdentity" = root."archiveUrlIdentity"
	left join history_archive_checkpoint_proof frontier
		on frontier."archiveUrlIdentity" = root."archiveUrlIdentity"
		and frontier."checkpointLedger" = cursor."nextHistoricalCheckpointLedger" - 64
	left join lateral (
		select case
			when state.status <> 'available' or state."currentLedger" < 63 then null
			else (floor((state."currentLedger" + 1)::numeric / 64) * 64 - 1)::integer
		end as "latestCheckpointLedger"
	) advertised on true
	left join lateral (
		select case
			when cursor."nextHistoricalCheckpointLedger" is null
				or cursor."nextHistoricalCheckpointLedger" = 63 then null
			when frontier.status = 'verified'
				then cursor."nextHistoricalCheckpointLedger" - 64
			when cursor."nextHistoricalCheckpointLedger" <= 127 then null
			else cursor."nextHistoricalCheckpointLedger" - 128
		end as "lastContinuouslyVerifiedCheckpointLedger"
	) coverage on true
	left join lateral (
		select candidate."objectType", candidate."objectUrl",
			candidate."httpStatus", candidate."errorType", candidate."updatedAt"
		from history_archive_object_queue candidate
		where candidate."archiveUrlIdentity" = root."archiveUrlIdentity"
			and candidate."checkpointLedger" = frontier."checkpointLedger"
			and candidate."checkpointLedger" <= advertised."latestCheckpointLedger"
			and candidate.status = 'failed'
			and candidate."objectType" in (
				'checkpoint-state', 'ledger', 'transactions', 'results', 'bucket'
			)
		order by case candidate."objectType"
			when 'checkpoint-state' then 0
			when 'ledger' then 1
			when 'transactions' then 2
			when 'results' then 3
			else 4
		end, candidate."updatedAt" desc, candidate.id desc
		limit 1
	) blocker on true
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
				and archive_object."failureChannel" in ('archive_evidence', 'archive_availability')
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
