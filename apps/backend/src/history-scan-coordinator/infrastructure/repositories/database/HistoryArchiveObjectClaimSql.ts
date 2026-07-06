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
	archive_claims as (
		select "archiveUrlIdentity", max("claimedAt") as last_claimed_at
		from history_archive_object_queue
		group by "archiveUrlIdentity"
	),
	next_candidate as (
		select candidate.id
		from history_archive_object_queue candidate
		cross join active_total
		left join active_archive
			on active_archive."archiveUrlIdentity" = candidate."archiveUrlIdentity"
		left join active_host
			on active_host."hostIdentity" = candidate."hostIdentity"
		left join host_throttle
			on host_throttle."hostIdentity" = candidate."hostIdentity"
		left join archive_claims
			on archive_claims."archiveUrlIdentity" = candidate."archiveUrlIdentity"
		where (
				candidate.status = 'pending'
				or (
					candidate.status = 'failed'
					and coalesce(
						candidate."nextAttemptAt",
						candidate."updatedAt" + interval '1 hour'
					) <= now()
				)
			)
			and candidate."objectType" = any($1)
			and active_total.active_count < $3
			and coalesce(active_archive.active_count, 0) < $2
			and coalesce(active_host.active_count, 0) < $4
			and host_throttle."hostIdentity" is null
		order by
			candidate."objectOrder" asc,
			candidate."objectKey" asc,
			archive_claims.last_claimed_at asc nulls first,
			candidate."archiveUrlIdentity" asc
		for update of candidate skip locked
		limit 1
	)
	update history_archive_object_queue
	set status = 'scanning',
		"claimedAt" = now(),
		"attempts" = "attempts" + 1,
		"workerStage" = 'claimed',
		"errorType" = null,
		"errorMessage" = null,
		"httpStatus" = null,
		"nextAttemptAt" = null,
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
