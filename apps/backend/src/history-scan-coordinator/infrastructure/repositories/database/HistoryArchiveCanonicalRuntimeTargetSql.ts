export const canonicalRuntimeTargetCtes = `
	forward_runtime_target as materialized (
		select "network_passphrase_hash", "checkpoint_ledger"::integer
			as checkpoint_ledger, 'forward'::text as target_lane
		from "full_history_promotion_runtime"
		where (
			state in ('promoting', 'waiting-for-proof')
			or (
				state = 'failed'
				and "last_outcome" = 'proof-pending'
				and "last_error_code" = 'promotion-invalid-source-evidence'
			)
		)
			and "checkpoint_ledger" is not null
	), historical_runtime_target as materialized (
		select ranked."network_passphrase_hash", ranked.checkpoint_ledger,
			'historical'::text as target_lane
		from (
			select job."network_passphrase_hash",
				(watermark."first_ledger" - 1)::integer as checkpoint_ledger,
				row_number() over (
					partition by job."network_passphrase_hash"
					order by case when job.state = 'leased' then 0 else 1 end,
						job."last_checkpoint_ledger" desc,
						job."created_at", job.id
				) as target_rank
			from "full_history_historical_backfill_job" job
			join "full_history_watermark" watermark
				on watermark."network_passphrase_hash" =
					job."network_passphrase_hash"
			where job.state in ('pending', 'leased')
				and watermark."first_ledger" > 1
				and watermark."first_ledger" - 1 between
					job."first_checkpoint_ledger"
					and job."last_checkpoint_ledger"
		) ranked
		where ranked.target_rank = 1
	), runtime_target as materialized (
		select "network_passphrase_hash", checkpoint_ledger, target_lane
		from forward_runtime_target
		union all
		select historical."network_passphrase_hash",
			historical.checkpoint_ledger, historical.target_lane
		from historical_runtime_target historical
		where not exists (
			select 1 from forward_runtime_target forward
			where forward."network_passphrase_hash" =
				historical."network_passphrase_hash"
				and forward.checkpoint_ledger = historical.checkpoint_ledger
		)
	)
`;
