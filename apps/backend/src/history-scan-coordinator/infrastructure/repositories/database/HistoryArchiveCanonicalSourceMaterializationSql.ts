export const maximumCanonicalSourceArchivesPerTarget = 2;

export const canonicalSourceMaterializationCtesSql = `
canonical_source_candidates as materialized (
	select target."network_passphrase_hash", target.checkpoint_ledger,
		target.target_lane, root."archiveUrl", root."archiveUrlIdentity",
		root."hostIdentity", root."lastClaimedAt",
		coalesce(
			coalesce(target_objects.has_failure, false)
				or proof.status = 'mismatch'
				or proof."failureKind" in (
					'checkpoint-ledger-mismatch',
					'checkpoint-bucket-list-mismatch',
					'transaction-hash-mismatch',
					'result-hash-mismatch',
					'previous-ledger-hash-mismatch',
					'object-failed'
				)
				or coalesce(proof."failedBucketCount", 0) > 0,
			false
		)
			as target_failed,
		coalesce(target_objects.was_materialized, false)
			and not coalesce(target_objects.has_failure, false)
			as retained_healthy_source,
		case
			when coalesce(target_objects.has_failure, false) then -3::numeric
			when proof.status = 'mismatch'
				or proof."failureKind" in (
					'checkpoint-ledger-mismatch',
					'checkpoint-bucket-list-mismatch',
					'transaction-hash-mismatch',
					'result-hash-mismatch',
					'previous-ledger-hash-mismatch'
				)
				then -2::numeric
			when proof."failureKind" = 'object-failed'
				or coalesce(proof."failedBucketCount", 0) > 0
				then -1::numeric
			when proof.status = 'verified'
				and proof."requiredObjectsComplete" = true
				and proof."proofFactsComplete" = true
				then 3::numeric
			else
				case when coalesce(proof."proofFactsComplete", false)
					then 1::numeric else 0::numeric end + case
					when coalesce(proof."expectedBucketCount", 0) > 0
						then coalesce(proof."verifiedBucketCount", 0)::numeric /
							proof."expectedBucketCount"::numeric
					else 0::numeric
				end
		end as current_proof_progress,
		proof."evaluatedAt" as current_proof_evaluated_at,
		recent_proof."checkpointLedger" as recent_healthy_checkpoint,
		recent_proof."evaluatedAt" as recent_healthy_evaluated_at
	from runtime_target target
	join "history_archive_state_snapshot" state
		on state.status = 'available'
		and state."networkPassphrase" is not null
		and sha256(convert_to(state."networkPassphrase", 'UTF8')) =
			target."network_passphrase_hash"
	join "history_archive_object_queue" root
		on root."archiveUrlIdentity" = state."archiveUrlIdentity"
		and root."objectType" = 'history-archive-state'
		and root."objectKey" = 'root'
		and root.status = 'verified'
	left join "history_archive_checkpoint_proof" proof
		on proof."archiveUrlIdentity" = state."archiveUrlIdentity"
		and proof."checkpointLedger" = target.checkpoint_ledger
	left join lateral (
		select bool_or(object.status = 'failed') as has_failure,
			bool_or(
				object."executionReason" = 'canonical-frontier-materialization'
				or object."dependenciesMaterializedAt" is not null
			) as was_materialized
		from "history_archive_object_queue" object
		where object."archiveUrlIdentity" = state."archiveUrlIdentity"
			and (
				(
					object."objectType" = 'checkpoint-state'
					and object."objectKey" in (
						'checkpoint-state:' || lpad(
							to_hex(target.checkpoint_ledger), 8, '0'
						),
						'checkpoint-state:' || lpad(
							to_hex(target.checkpoint_ledger - 64), 8, '0'
						)
					)
				)
				or (
					object."objectType" = 'ledger'
					and object."objectKey" in (
						'ledger:' || lpad(to_hex(target.checkpoint_ledger), 8, '0'),
						'ledger:' || lpad(
							to_hex(target.checkpoint_ledger - 64), 8, '0'
						)
					)
				)
				or (
					object."objectType" in ('transactions', 'results', 'scp')
					and object."objectKey" = object."objectType" || ':' ||
						lpad(to_hex(target.checkpoint_ledger), 8, '0')
				)
			)
	) target_objects on true
	left join lateral (
		select recent."checkpointLedger", recent."evaluatedAt"
		from "history_archive_checkpoint_proof" recent
		where recent."archiveUrlIdentity" = state."archiveUrlIdentity"
			and recent."checkpointLedger" < target.checkpoint_ledger
			and recent.status = 'verified'
			and recent."requiredObjectsComplete" = true
			and recent."proofFactsComplete" = true
			and recent."failureKind" is null
			and coalesce(recent."failedBucketCount", 0) = 0
		order by recent."checkpointLedger" desc, recent."evaluatedAt" desc
		limit 1
	) recent_proof on true
), canonical_source_host_ranked as materialized (
	select candidate.*,
		row_number() over (
			partition by candidate."network_passphrase_hash",
				candidate.checkpoint_ledger, candidate.target_lane,
				candidate."hostIdentity"
			order by candidate.target_failed,
				candidate.current_proof_progress desc,
				candidate.retained_healthy_source desc,
				candidate.recent_healthy_checkpoint desc nulls last,
				candidate.recent_healthy_evaluated_at desc nulls last,
				candidate.current_proof_evaluated_at desc nulls last,
				candidate."lastClaimedAt" asc nulls first,
				candidate."archiveUrlIdentity"
		) as host_candidate_rank
	from canonical_source_candidates candidate
), canonical_source_ranked as materialized (
	select candidate.*,
		row_number() over (
			partition by candidate."network_passphrase_hash",
				candidate.checkpoint_ledger, candidate.target_lane
			order by candidate.target_failed,
				candidate.host_candidate_rank,
				candidate.current_proof_progress desc,
				candidate.retained_healthy_source desc,
				candidate.recent_healthy_checkpoint desc nulls last,
				candidate.recent_healthy_evaluated_at desc nulls last,
				candidate.current_proof_evaluated_at desc nulls last,
				candidate."lastClaimedAt" asc nulls first,
				candidate."hostIdentity", candidate."archiveUrlIdentity"
		) as source_rank
	from canonical_source_host_ranked candidate
), runtime_archive_roots as materialized (
	select source."archiveUrl", source."archiveUrlIdentity",
		source."hostIdentity", source.checkpoint_ledger,
		source.target_lane
	from canonical_source_ranked source
	where source.source_rank <= ${maximumCanonicalSourceArchivesPerTarget}
)
`;
