with queue as (
	select count(*)::bigint as depth,
		count(*) filter (where attempts > 0)::bigint as retrying,
		count(*) filter (
			where "leaseUntil" is not null and "leaseUntil" > now()
		)::bigint as leased,
		coalesce(max(attempts), 0)::integer as maximum_attempts,
		min("requestedAt") as oldest_requested_at,
		min("nextAttemptAt") as oldest_due_at
	from history_archive_checkpoint_proof_refresh_queue
), seed as (
	select "cutoffProofId" as cutoff_proof_id,
		"lastProofId" as last_proof_id,
		complete as seed_complete,
		"updatedAt" as seed_updated_at
	from history_archive_checkpoint_proof_refresh_seed_progress
	where id = 1
)
select queue.*,
	seed.cutoff_proof_id,
	seed.last_proof_id,
	seed.seed_complete,
	seed.seed_updated_at
from queue
left join seed on true;
