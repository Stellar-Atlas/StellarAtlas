export const historyArchiveObjectClaimLockSql =
	'select pg_try_advisory_xact_lock(hashtext($1)) as locked';

export const historyArchiveObjectClaimSql = `
	with
	active_total as (
		select count(*) as active_count
		from history_archive_object_queue
		where status = 'scanning'
	),
	active_archive as (
		select "archiveUrlIdentity", count(*) as active_count
		from history_archive_object_queue
		where status = 'scanning'
		group by "archiveUrlIdentity"
	),
	active_host as (
		select "hostIdentity", count(*) as active_count
		from history_archive_object_queue
		where status = 'scanning'
		group by "hostIdentity"
	),
	host_throttle as (
		select "hostIdentity"
		from history_archive_object_host_throttle
		where "blockedUntil" > now()
	),
	pending_candidates as (
		select
			candidate.id,
			candidate."archiveUrlIdentity",
			candidate."hostIdentity",
			candidate."objectType",
			candidate."objectOrder",
			candidate."checkpointLedger",
			candidate."objectKey"
		from history_archive_object_queue candidate
		cross join active_total
		left join active_archive
			on active_archive."archiveUrlIdentity" = candidate."archiveUrlIdentity"
		left join active_host
			on active_host."hostIdentity" = candidate."hostIdentity"
		where candidate.status = 'pending'
			and candidate."objectType" = any($1)
			and active_total.active_count < $3
			and coalesce(active_archive.active_count, 0) < $2
			and coalesce(active_host.active_count, 0) < $4
			and not exists (
				select 1
				from host_throttle
				where host_throttle."hostIdentity" = candidate."hostIdentity"
			)
		order by
			case
				when candidate."objectType" = 'history-archive-state' then 0
				when candidate."objectType" = 'checkpoint-state' then 2
				else 1
			end asc,
			coalesce(candidate."checkpointLedger", -1) desc,
			candidate."objectOrder" asc,
			candidate."objectKey" asc,
			candidate."archiveUrlIdentity" asc
		limit 512
	),
	failed_candidates as (
		select
			candidate.id,
			candidate."archiveUrlIdentity",
			candidate."hostIdentity",
			candidate."objectType",
			candidate."objectOrder",
			candidate."checkpointLedger",
			candidate."objectKey"
		from history_archive_object_queue candidate
		cross join active_total
		left join active_archive
			on active_archive."archiveUrlIdentity" = candidate."archiveUrlIdentity"
		left join active_host
			on active_host."hostIdentity" = candidate."hostIdentity"
		where candidate.status = 'failed'
			and coalesce(
				candidate."nextAttemptAt",
				candidate."updatedAt" + interval '1 hour'
			) <= now()
			and candidate."objectType" = any($1)
			and active_total.active_count < $3
			and coalesce(active_archive.active_count, 0) < $2
			and coalesce(active_host.active_count, 0) < $4
			and not exists (
				select 1
				from host_throttle
				where host_throttle."hostIdentity" = candidate."hostIdentity"
			)
		order by
			case
				when candidate."objectType" = 'history-archive-state' then 0
				when candidate."objectType" = 'checkpoint-state' then 2
				else 1
			end asc,
			coalesce(candidate."checkpointLedger", -1) desc,
			candidate."objectOrder" asc,
			candidate."objectKey" asc,
			candidate."archiveUrlIdentity" asc
		limit 64
	),
	candidate_pool as (
		select * from pending_candidates
		union all
		select * from failed_candidates
	),
	next_candidate as (
		select candidate.id
		from candidate_pool candidate
		cross join active_total
		left join active_archive
			on active_archive."archiveUrlIdentity" = candidate."archiveUrlIdentity"
		left join active_host
			on active_host."hostIdentity" = candidate."hostIdentity"
		left join host_throttle
			on host_throttle."hostIdentity" = candidate."hostIdentity"
		where active_total.active_count < $3
			and coalesce(active_archive.active_count, 0) < $2
			and coalesce(active_host.active_count, 0) < $4
			and host_throttle."hostIdentity" is null
		order by
			case
				when candidate."objectType" = 'history-archive-state' then 0
				when candidate."objectType" = 'checkpoint-state' then 2
				else 1
			end asc,
			coalesce(candidate."checkpointLedger", -1) desc,
			candidate."objectOrder" asc,
			candidate."objectKey" asc,
			candidate."archiveUrlIdentity" asc
		limit 1
	)
	update history_archive_object_queue
	set status = 'scanning',
		"claimedAt" = now(),
		"attempts" = "attempts" + 1,
		"bytesDownloaded" = null,
		"workerStage" = 'claimed',
		"errorType" = null,
		"errorMessage" = null,
		"httpStatus" = null,
		"nextAttemptAt" = null,
		"verificationFacts" = null,
		"updatedAt" = now()
	where id = (select id from next_candidate)
	returning
		"remoteId" as "remoteId",
		"archiveUrl" as "archiveUrl",
		"archiveUrlIdentity" as "archiveUrlIdentity",
		"hostIdentity" as "hostIdentity",
		"objectType" as "objectType",
		"objectKey" as "objectKey",
		"objectOrder" as "objectOrder",
		"objectUrl" as "objectUrl",
		status as "status",
		"workerStage" as "workerStage",
		"checkpointLedger" as "checkpointLedger",
		"bucketHash" as "bucketHash",
		"bytesDownloaded" as "bytesDownloaded",
		attempts as "attempts",
		"nextAttemptAt" as "nextAttemptAt",
		"refreshAfter" as "refreshAfter",
		"claimedAt" as "claimedAt",
		"claimedByCommunityScannerId" as "claimedByCommunityScannerId",
		"errorType" as "errorType",
		"errorMessage" as "errorMessage",
		"httpStatus" as "httpStatus",
		"verificationFacts" as "verificationFacts",
		"verifiedAt" as "verifiedAt",
		"createdAt" as "createdAt",
		"updatedAt" as "updatedAt"
`;
