import { canonicalBucketHasStrictSourceProofSql } from './HistoryArchiveCanonicalBucketProofSql.js';
import {
	canonicalCategoryAdmissionCteSql,
	canonicalCategoryTargetsCteSql
} from './HistoryArchiveCanonicalCategorySql.js';
import { canonicalCheckpointHasStrictContentDigestSql } from './HistoryArchiveCanonicalCheckpointProofSql.js';
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

export const materializeCanonicalFrontierDependenciesSql = `
	with ${canonicalRuntimeTargetCtes}, checkpoints as materialized (
		select checkpoint.*, state."networkPassphrase"
		from runtime_target target
		join "history_archive_state_snapshot" state
			on state.status = 'available'
			and state."networkPassphrase" is not null
			and sha256(convert_to(state."networkPassphrase", 'UTF8')) =
				target."network_passphrase_hash"
		join "history_archive_object_queue" checkpoint
			on checkpoint."archiveUrlIdentity" = state."archiveUrlIdentity"
			and checkpoint."objectType" = 'checkpoint-state'
			and checkpoint."objectKey" = 'checkpoint-state:' ||
				lpad(to_hex(target.checkpoint_ledger), 8, '0')
			and checkpoint."checkpointLedger" = target.checkpoint_ledger
			and checkpoint.status = 'verified'
	), hashes as materialized (
		select distinct checkpoint."archiveUrlIdentity",
			checkpoint."checkpointLedger", lower(hash.value) as "bucketHash"
		from checkpoints checkpoint
		cross join lateral jsonb_array_elements(
			coalesce(
				checkpoint."verificationFacts"
					->'checkpointHistoryArchiveState'
					->'stellarHistory'
					->'currentBuckets',
				'[]'::jsonb
			)
			|| coalesce(
				checkpoint."verificationFacts"
					->'checkpointHistoryArchiveState'
					->'stellarHistory'
					->'hotArchiveBuckets',
				'[]'::jsonb
			)
		) bucket
		cross join lateral (
			values (bucket->>'curr'), (bucket->>'snap'),
				(bucket->'next'->>'output')
		) hash(value)
		where hash.value is not null
			and lower(hash.value) ~ '^[0-9a-f]{64}$'
			and lower(hash.value) !~ '^0+$'
	), ${canonicalCategoryTargetsCteSql}, inserted as (
		insert into "history_archive_checkpoint_bucket_dependency" (
			"archiveUrlIdentity", "checkpointLedger", "bucketHash"
		)
		select "archiveUrlIdentity", "checkpointLedger", "bucketHash"
		from hashes
		on conflict do nothing
		returning "archiveUrlIdentity"
	), marked as (
		update "history_archive_object_queue" checkpoint
		set "dependenciesMaterializedAt" = now()
		from checkpoints target
		where checkpoint.id = target.id
			and checkpoint."dependenciesMaterializedAt" is null
			and coalesce((
				${canonicalCheckpointHasStrictContentDigestSql('checkpoint')}
			), false)
		returning checkpoint.id
	), reopened_legacy_checkpoints as (
		update "history_archive_object_queue" candidate
		set status = 'pending', "workerStage" = null,
			"bytesDownloaded" = null, "nextAttemptAt" = null,
			"refreshAfter" = null, "dependencyReady" = true,
			"executionDisposition" = 'deferred',
			"executionReason" = 'canonical-proof-revalidation',
			"executionDispositionAt" = now(), "verifiedAt" = null,
			"dependenciesMaterializedAt" = now(),
			"updatedAt" = now()
		from checkpoints target
		where candidate.id = target.id
			and not coalesce((
				${canonicalCheckpointHasStrictContentDigestSql('candidate')}
			), false)
		returning candidate.id
	), activated_categories as (
		update "history_archive_object_queue" candidate
		set "dependencyReady" = true
		from category_targets target
		where candidate."archiveUrlIdentity" = target."archiveUrlIdentity"
			and candidate."objectType" = target.object_type
			and candidate."objectKey" = target.object_key
			and candidate."checkpointLedger" = target.checkpoint_ledger
			and candidate."dependencyReady" is distinct from true
		returning candidate.id
	), activated_buckets as (
		update "history_archive_object_queue" candidate
		set "dependencyReady" = true
		from hashes target
		where candidate."archiveUrlIdentity" = target."archiveUrlIdentity"
			and candidate."objectType" = 'bucket'
			and candidate."objectKey" = 'bucket:' || target."bucketHash"
			and candidate."bucketHash" = target."bucketHash"
			and candidate."dependencyReady" is distinct from true
			and not (
				candidate.status = 'verified'
				and not coalesce((
					${canonicalBucketHasStrictSourceProofSql}
				), false)
			)
		returning candidate.id
	), reopened_legacy_buckets as (
		update "history_archive_object_queue" candidate
		set status = 'pending', "workerStage" = null,
			"bytesDownloaded" = null, "nextAttemptAt" = null,
			"refreshAfter" = null, "dependencyReady" = true,
			"executionDisposition" = 'deferred',
			"executionReason" = 'canonical-proof-revalidation',
			"executionDispositionAt" = now(), "verifiedAt" = null,
			"updatedAt" = now()
		from hashes target
		where candidate."archiveUrlIdentity" = target."archiveUrlIdentity"
			and candidate."objectType" = 'bucket'
			and candidate."objectKey" = 'bucket:' || target."bucketHash"
			and candidate."bucketHash" = target."bucketHash"
			and candidate.status = 'verified'
			and not coalesce((
				${canonicalBucketHasStrictSourceProofSql}
			), false)
		returning candidate.id
	)
	select
		(select count(*)::integer from inserted) as inserted,
		(select count(*)::integer from marked) as marked,
		(select count(*)::integer from inserted_predecessor_checkpoints) +
			(select count(*)::integer from inserted_categories) +
			(select count(*)::integer from reopened_legacy_checkpoints) +
			(select count(*)::integer from activated_categories) +
			(select count(*)::integer from activated_buckets) +
			(select count(*)::integer from reopened_legacy_buckets) as activated
`;

export const admitCanonicalFrontierSql = `
	with ${canonicalRuntimeTargetCtes}, network_roots as materialized (
		select state."archiveUrlIdentity", target.checkpoint_ledger,
			target.target_lane,
			root."lastClaimedAt",
			case
				when coalesce(proof."expectedBucketCount", 0) > 0
					then coalesce(proof."verifiedBucketCount", 0)::numeric /
						proof."expectedBucketCount"::numeric
				else 0::numeric
			end as proof_progress
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
		join "history_archive_object_queue" checkpoint
			on checkpoint."archiveUrlIdentity" = state."archiveUrlIdentity"
			and checkpoint."objectType" = 'checkpoint-state'
			and checkpoint."objectKey" = 'checkpoint-state:' ||
				lpad(to_hex(target.checkpoint_ledger), 8, '0')
			and checkpoint."checkpointLedger" = target.checkpoint_ledger
			and (
				checkpoint.status = 'verified'
				or (
					checkpoint.status = 'pending'
					and checkpoint."executionReason" =
						'canonical-proof-revalidation'
				)
			)
		left join "history_archive_checkpoint_proof" proof
			on proof."archiveUrlIdentity" = state."archiveUrlIdentity"
			and proof."checkpointLedger" = target.checkpoint_ledger
	), ${canonicalCategoryAdmissionCteSql}, bucket_objects as materialized (
		select network_root."archiveUrlIdentity",
			network_root."lastClaimedAt", network_root.proof_progress,
			network_root.target_lane,
			'bucket'::text as object_type,
			null::integer as object_checkpoint_ledger,
			'bucket:' || dependency."bucketHash" as object_key,
			5 as object_priority
		from network_roots network_root
		join "history_archive_checkpoint_bucket_dependency" dependency
			on dependency."archiveUrlIdentity" =
				network_root."archiveUrlIdentity"
			and dependency."checkpointLedger" = network_root.checkpoint_ledger
	), desired_objects as materialized (
		select * from category_objects
		union all
		select * from bucket_objects
	), canonical_roots as materialized (
		select distinct desired."archiveUrlIdentity"
		from desired_objects desired
		join "history_archive_object_queue" reserved
			on reserved."archiveUrlIdentity" = desired."archiveUrlIdentity"
			and reserved."objectType" = desired.object_type
			and reserved."objectKey" = desired.object_key
			and reserved.status = 'pending'
			and reserved."executionDisposition" = 'executable'
			and reserved."executionReason" = 'canonical-frontier-reserve'
	), protected_roots as materialized (
		select distinct protected."archiveUrlIdentity"
		from "history_archive_object_queue" protected
		where protected.status = 'scanning'
		union
		select "archiveUrlIdentity" from canonical_roots
		union
		select distinct protected."archiveUrlIdentity"
		from "history_archive_object_queue" protected
		where protected.status = 'pending'
			and protected."executionDisposition" = 'executable'
			and protected."dependencyReady" = true
			and protected."executionReason" = 'proof-completion-reserve'
		union
		select distinct protected."archiveUrlIdentity"
		from "history_archive_object_queue" protected
		where protected.status = 'failed'
			and protected."executionDisposition" = 'executable'
			and protected."dependencyReady" = true
			and coalesce(
				protected."nextAttemptAt",
				protected."updatedAt" + interval '1 hour'
			) <= now()
	), host_activity as materialized (
		select "hostIdentity", count(*)::integer as active_count
		from "history_archive_object_queue"
		where status = 'scanning'
		group by "hostIdentity"
	), outstanding as materialized (
		select count(*)::integer as count
		from (
			select id from "history_archive_object_queue" where status = 'scanning'
			union all
			select id from "history_archive_object_queue"
			where status = 'pending'
				and "executionDisposition" = 'executable'
				and "dependencyReady" = true
			union all
			select id from "history_archive_object_queue"
			where status = 'failed'
				and "executionDisposition" = 'executable'
				and "dependencyReady" = true
				and coalesce(
					"nextAttemptAt", "updatedAt" + interval '1 hour'
				) <= now()
		) runnable
	), candidates as materialized (
		select distinct on (candidate.id)
			candidate.id, candidate."archiveUrlIdentity",
			candidate."hostIdentity", candidate."objectKey",
			candidate."checkpointLedger", desired.object_priority,
			desired.proof_progress, desired.target_lane,
			desired."lastClaimedAt",
			replaceable.id as replaceable_id,
			coalesce(host.active_count, 0) as host_active
		from desired_objects desired
		join "history_archive_object_queue" candidate
			on candidate."archiveUrlIdentity" = desired."archiveUrlIdentity"
			and candidate."objectType" = desired.object_type
			and candidate."objectKey" = desired.object_key
			and candidate."checkpointLedger" is not distinct from
				desired.object_checkpoint_ledger
			and candidate.status = 'pending'
			and candidate."dependencyReady" = true
		left join protected_roots protected
			on protected."archiveUrlIdentity" = desired."archiveUrlIdentity"
		left join host_activity host
			on host."hostIdentity" = candidate."hostIdentity"
		left join lateral (
			select generic.id
			from "history_archive_object_queue" generic
			where generic."archiveUrlIdentity" = desired."archiveUrlIdentity"
				and generic.status = 'pending'
				and generic."executionDisposition" = 'executable'
				and generic."dependencyReady" = true
				and (
					generic."executionReason" is null
					or generic."executionReason" not in (
						'canonical-frontier-reserve',
						'proof-completion-reserve'
					)
				)
			order by generic.id
			limit 1
		) replaceable on true
		where protected."archiveUrlIdentity" is null
			and candidate."executionReason" is distinct from
				'canonical-frontier-reserve'
		order by candidate.id, desired.object_priority, desired.target_lane
	), root_ranked as materialized (
		select candidates.*,
			row_number() over (
				partition by "archiveUrlIdentity", target_lane
				order by object_priority, "objectKey", id
			) as root_rank
		from candidates
	), lane_host_ranked as materialized (
		select root_ranked.*,
			row_number() over (
				partition by "hostIdentity", target_lane
				order by proof_progress desc,
					"lastClaimedAt" asc nulls first,
					"archiveUrlIdentity", object_priority, id
			) as lane_host_rank
		from root_ranked
		where root_rank = 1
	), host_ranked as materialized (
		select lane_host_ranked.*,
			row_number() over (
				partition by "hostIdentity"
				order by lane_host_rank, target_lane,
					proof_progress desc,
					"lastClaimedAt" asc nulls first,
					"archiveUrlIdentity", object_priority, id
			) as host_rank
		from lane_host_ranked
	), target_ranked as materialized (
		select host_ranked.*,
			dense_rank() over (
				order by "archiveUrlIdentity"
			) as reservation_root_rank,
			row_number() over (
				partition by target_lane
				order by proof_progress desc,
					"lastClaimedAt" asc nulls first,
					"archiveUrlIdentity", object_priority, id
			) as target_rank
		from host_ranked
		where host_rank <= greatest($3::integer - host_active, 0)
	), replacement_ranked as materialized (
		select target_ranked.*,
			case
				when replaceable_id is not null and row_number() over (
					partition by replaceable_id
					order by case
						when mod(reservation_root_rank, 2) = 1
							and target_lane = 'forward' then 0
						when mod(reservation_root_rank, 2) = 0
							and target_lane = 'historical' then 0
						else 1
					end,
						target_rank, target_lane,
						proof_progress desc,
						"lastClaimedAt" asc nulls first,
						"archiveUrlIdentity", id
				) = 1 then replaceable_id
				else null
			end as selected_replaceable_id
		from target_ranked
	), additions_ranked as materialized (
		select replacement_ranked.*,
			count(*) filter (where selected_replaceable_id is null) over (
				order by target_rank, target_lane, proof_progress desc,
					"lastClaimedAt" asc nulls first,
					"archiveUrlIdentity", id
			) as addition_rank
		from replacement_ranked
	), selected as materialized (
		select candidate.*
		from additions_ranked candidate
		cross join outstanding
		where candidate.selected_replaceable_id is not null
			or candidate.addition_rank <= greatest(
				$2::integer - outstanding.count, 0
			)
		order by candidate.target_rank, candidate.target_lane,
			(candidate.selected_replaceable_id is null),
			candidate.proof_progress desc,
			candidate."lastClaimedAt" asc nulls first,
			candidate."archiveUrlIdentity", candidate.id
		limit $1::integer
	), demoted as (
		update "history_archive_object_queue" generic
		set "executionDisposition" = 'deferred',
			"executionReason" = 'frontier-waiting',
			"executionDispositionAt" = now()
		from selected
		where generic.id = selected.selected_replaceable_id
			and generic.id <> selected.id
		returning generic.id
	), admitted as (
		update "history_archive_object_queue" candidate
		set "executionDisposition" = 'executable',
			"executionReason" = 'canonical-frontier-reserve',
			"executionDispositionAt" = now(),
			"dependencyReady" = true,
			"nextAttemptAt" = null,
			"refreshAfter" = null
		from selected
		where candidate.id = selected.id
		returning candidate.id
	)
	select count(*)::integer as count from admitted
`;
