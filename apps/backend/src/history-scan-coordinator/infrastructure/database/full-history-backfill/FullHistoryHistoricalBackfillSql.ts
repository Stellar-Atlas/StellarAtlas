export const historicalBackfillJobProjection = `
	id, "network_passphrase_hash" as "networkPassphraseHash",
	"first_checkpoint_ledger"::text as "firstCheckpointLedger",
	"last_checkpoint_ledger"::text as "lastCheckpointLedger",
	state, "attempt_count" as "attemptCount", "max_attempts" as "maxAttempts",
	"available_at" as "availableAt", "lease_owner" as "leaseOwner",
	"lease_token" as "leaseToken", "lease_expires_at" as "leaseExpiresAt",
	"last_error_code" as "lastErrorCode", "completed_at" as "completedAt",
	"created_at" as "createdAt", "updated_at" as "updatedAt"
`;

export const claimHistoricalBackfillJobSql = `
	with exhausted as (
		update "full_history_historical_backfill_job"
		set state = 'failed', "lease_owner" = null, "lease_token" = null,
			"lease_expires_at" = null,
			"last_error_code" = coalesce("last_error_code", 'lease-exhausted'),
			"updated_at" = now()
		where "network_passphrase_hash" = $1 and state = 'leased'
			and "lease_expires_at" <= now()
			and "attempt_count" >= "max_attempts"
		returning id
	), candidate as (
		select job.id
		from "full_history_historical_backfill_job" job
		join "full_history_watermark" watermark
			on watermark."network_passphrase_hash" =
				job."network_passphrase_hash"
		where job."network_passphrase_hash" = $1
			and job."attempt_count" < job."max_attempts"
			and (
				(job.state = 'pending' and job."available_at" <= now())
				or (job.state = 'leased' and job."lease_expires_at" <= now())
			)
			and watermark."first_ledger" <= job."last_checkpoint_ledger" + 1
		order by
			case when job."lease_owner" = $2 then 0 else 1 end,
			job."last_checkpoint_ledger" desc, job."created_at", job.id
		for update of job skip locked
		limit 1
	), claimed as (
		update "full_history_historical_backfill_job" job
		set state = 'leased', "attempt_count" = job."attempt_count" + 1,
			"lease_owner" = $2, "lease_token" = $3,
			"lease_expires_at" = now() + $4::integer * interval '1 millisecond',
			"updated_at" = now()
		from candidate where job.id = candidate.id
		returning job.*
	)
	select ${historicalBackfillJobProjection} from claimed
`;

export const completeHistoricalBackfillJobSql = `
	with completed as (
		update "full_history_historical_backfill_job" job
		set state = 'completed', "lease_owner" = null, "lease_token" = null,
			"lease_expires_at" = null, "completed_at" = now(),
			"last_error_code" = null, "updated_at" = now()
		from "full_history_watermark" watermark
		where job.id = $1 and job.state = 'leased' and job."lease_owner" = $2
			and job."lease_token" = $3 and job."lease_expires_at" > now()
			and watermark."network_passphrase_hash" =
				job."network_passphrase_hash"
			and watermark."first_ledger" <= case
				when job."first_checkpoint_ledger" = 63 then 1
				else job."first_checkpoint_ledger" - 63 end
		returning job.id
	)
	select id from completed
`;

export const strictHistoricalBackfillProofTargetsSql = `
	select proof."archiveUrlIdentity"
	from "history_archive_checkpoint_proof" proof
	where proof."checkpointLedger" = $1
		and proof.status = 'verified'
		and proof."failureKind" is null
		and proof."requiredObjectsComplete"
		and proof."proofFactsComplete"
		and proof."ledgerFactCount" = case when $1 = 63 then 63 else 64 end
		and proof."transactionFactCount" = case when $1 = 63 then 63 else 64 end
		and proof."resultFactCount" = case when $1 = 63 then 63 else 64 end
		and proof."checkpointBucketListMatches"
		and proof."transactionsMatch"
		and proof."resultsMatch"
		and proof."previousLedgersMatch"
		and proof."bucketsVerified"
		and proof."checkpointStateObjectRemoteId" is not null
		and proof."ledgerObjectRemoteId" is not null
		and proof."transactionsObjectRemoteId" is not null
		and proof."resultsObjectRemoteId" is not null
		and proof.details ->> 'networkPassphrase' = $2
	order by proof."evaluatedAt" desc, proof."archiveUrlIdentity"
	limit $3
`;
