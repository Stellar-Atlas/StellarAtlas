import { canonicalBucketHasStrictSourceProofSql } from './HistoryArchiveCanonicalBucketProofSql.js';
import { canonicalCategoryHasStrictSourceProofSql } from './HistoryArchiveCanonicalCategoryProofSql.js';
import { canonicalBucketMaterializationCteSql } from './HistoryArchiveCanonicalBucketMaterializationSql.js';
import {
	canonicalCategoryAdmissionCteSql,
	canonicalCategoryTargetsCteSql
} from './HistoryArchiveCanonicalCategorySql.js';
import { canonicalCheckpointHasStrictEvidenceSql } from './HistoryArchiveCanonicalCheckpointProofSql.js';
import { canonicalFrontierReservationCtesSql } from './HistoryArchiveCanonicalReservationSql.js';
import { canonicalRuntimeTargetCtes } from './HistoryArchiveCanonicalRuntimeTargetSql.js';
import { historyArchiveMinimumWatermark } from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveObjectPlanningPolicy.js';
export { canonicalRuntimeTargetCtes } from './HistoryArchiveCanonicalRuntimeTargetSql.js';

export const materializeCanonicalFrontierDependenciesSql = `
	with ${canonicalRuntimeTargetCtes}, runtime_archive_roots as materialized (
		select root."archiveUrl", root."archiveUrlIdentity",
			root."hostIdentity", target.checkpoint_ledger
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
	), inserted_target_checkpoints as (
		insert into "history_archive_object_queue" (
			"remoteId", "archiveUrl", "archiveUrlIdentity", "hostIdentity",
			"objectType", "objectKey", "objectOrder", "objectUrl",
			status, "checkpointLedger", "dependencyReady",
			"executionDisposition", "executionReason",
			"executionDispositionAt", "createdAt", "updatedAt"
		)
		select gen_random_uuid(), target."archiveUrl",
			target."archiveUrlIdentity", target."hostIdentity",
			'checkpoint-state', 'checkpoint-state:' || checkpoint_hex.hex, 10,
			rtrim(target."archiveUrl", '/') || '/history/' ||
				substring(checkpoint_hex.hex from 1 for 2) || '/' ||
				substring(checkpoint_hex.hex from 3 for 2) || '/' ||
				substring(checkpoint_hex.hex from 5 for 2) || '/' ||
				'history-' || checkpoint_hex.hex || '.json',
			'pending', target.checkpoint_ledger, true, 'deferred',
			'canonical-frontier-materialization', now(), now(), now()
		from runtime_archive_roots target
		cross join lateral (
			select lpad(to_hex(target.checkpoint_ledger), 8, '0') as hex
		) checkpoint_hex
		on conflict ("archiveUrlIdentity", "objectType", "objectKey")
			do nothing
		returning id
	), checkpoints as materialized (
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
	), ${canonicalCategoryTargetsCteSql}, ${canonicalBucketMaterializationCteSql}, inserted as (
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
				${canonicalCheckpointHasStrictEvidenceSql('checkpoint')}
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
				${canonicalCheckpointHasStrictEvidenceSql('candidate')}
			), false)
		returning candidate.id
	), reopened_legacy_categories as (
		update "history_archive_object_queue" candidate
		set status = 'pending', "workerStage" = null,
			"bytesDownloaded" = null, "nextAttemptAt" = null,
			"refreshAfter" = null, "dependencyReady" = true,
			"executionDisposition" = 'deferred',
			"executionReason" = 'canonical-proof-revalidation',
			"executionDispositionAt" = now(), "verifiedAt" = null,
			"updatedAt" = now()
		from category_targets target
		where candidate."archiveUrlIdentity" = target."archiveUrlIdentity"
			and candidate."objectType" = target.object_type
			and candidate."objectKey" = target.object_key
			and candidate."checkpointLedger" = target.checkpoint_ledger
			and candidate.status = 'verified'
			and not coalesce((
				${canonicalCategoryHasStrictSourceProofSql}
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
			and not (
				candidate.status = 'verified'
				and not coalesce((
					${canonicalCategoryHasStrictSourceProofSql}
				), false)
			)
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
			(select count(*)::integer from inserted_target_checkpoints) +
			(select count(*)::integer from inserted_categories) +
			(select count(*)::integer from inserted_buckets) +
			(select count(*)::integer from reopened_legacy_checkpoints) +
			(select count(*)::integer from activated_categories) +
			(select count(*)::integer from reopened_legacy_categories) +
			(select count(*)::integer from activated_buckets) +
			(select count(*)::integer from reopened_legacy_buckets) as activated
`;

export const admitCanonicalFrontierSql = `
	with ${canonicalRuntimeTargetCtes}, runtime_archive_roots as materialized (
		select state."archiveUrlIdentity", target.checkpoint_ledger,
			target.target_lane,
			root."lastClaimedAt",
			case when coalesce(proof."proofFactsComplete", false)
				then 1::numeric else 0::numeric end + case
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
			and not exists (
				select 1
				from "history_archive_object_host_throttle" throttle
				where throttle."hostIdentity" = root."hostIdentity"
					and throttle."blockedUntil" > now()
			)
		left join "history_archive_checkpoint_proof" proof
			on proof."archiveUrlIdentity" = state."archiveUrlIdentity"
			and proof."checkpointLedger" = target.checkpoint_ledger
	), pending_target_checkpoint_objects as materialized (
		select runtime_root."archiveUrlIdentity",
			runtime_root."lastClaimedAt", runtime_root.proof_progress,
			runtime_root.target_lane,
			'checkpoint-state'::text as object_type,
			runtime_root.checkpoint_ledger as object_checkpoint_ledger,
			checkpoint."objectKey" as object_key, -2 as object_priority
		from runtime_archive_roots runtime_root
		join "history_archive_object_queue" checkpoint
			on checkpoint."archiveUrlIdentity" =
				runtime_root."archiveUrlIdentity"
			and checkpoint."objectType" = 'checkpoint-state'
			and checkpoint."objectKey" = 'checkpoint-state:' ||
				lpad(to_hex(runtime_root.checkpoint_ledger), 8, '0')
			and checkpoint."checkpointLedger" =
				runtime_root.checkpoint_ledger
			and checkpoint.status = 'pending'
			and checkpoint."executionReason" is distinct from
				'canonical-proof-revalidation'
	), network_roots as materialized (
		select runtime_root.*
		from runtime_archive_roots runtime_root
		join "history_archive_object_queue" checkpoint
			on checkpoint."archiveUrlIdentity" =
				runtime_root."archiveUrlIdentity"
			and checkpoint."objectType" = 'checkpoint-state'
			and checkpoint."objectKey" = 'checkpoint-state:' ||
				lpad(to_hex(runtime_root.checkpoint_ledger), 8, '0')
			and checkpoint."checkpointLedger" =
				runtime_root.checkpoint_ledger
			and (
				checkpoint.status = 'verified'
				or (
					checkpoint.status = 'pending'
					and checkpoint."executionReason" =
						'canonical-proof-revalidation'
				)
			)
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
		select * from pending_target_checkpoint_objects
		union all
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
		select "archiveUrlIdentity" from canonical_roots
	), outstanding as materialized (
		select count(*)::integer as count
		from (
			select id from "history_archive_object_queue" where status = 'scanning'
			union all
			select candidate.id from "history_archive_object_queue" candidate
			where candidate.status = 'pending'
				and candidate."executionDisposition" = 'executable'
				and candidate."dependencyReady" = true
				and (
					candidate."transitionEffectsRequiredAt" is null
					or candidate."transitionEffectsCompletedAt" is not null
				)
				and not exists (
					select 1
					from "history_archive_object_host_throttle" throttle
					where throttle."hostIdentity" = candidate."hostIdentity"
						and throttle."blockedUntil" > now()
				)
			union all
			select candidate.id from "history_archive_object_queue" candidate
			where candidate.status = 'failed'
				and candidate."executionDisposition" = 'executable'
				and candidate."dependencyReady" = true
				and (
					candidate."transitionEffectsRequiredAt" is null
					or candidate."transitionEffectsCompletedAt" is not null
				)
				and not exists (
					select 1
					from "history_archive_object_host_throttle" throttle
					where throttle."hostIdentity" = candidate."hostIdentity"
						and throttle."blockedUntil" > now()
				)
				and coalesce(
					candidate."nextAttemptAt",
					candidate."updatedAt" + interval '1 hour'
				) <= now()
		) runnable
	), candidates as materialized (
		select distinct on (candidate.id)
			candidate.id, candidate."archiveUrlIdentity",
			candidate."hostIdentity", candidate."objectKey",
			candidate."checkpointLedger", desired.object_priority,
			desired.proof_progress, desired.target_lane,
			desired."lastClaimedAt"
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
		where protected."archiveUrlIdentity" is null
			and candidate."executionReason" is distinct from
				'canonical-frontier-reserve'
		order by candidate.id, desired.object_priority,
			case desired.target_lane
				when 'forward' then 0
				when 'historical' then 1
				else 2
			end
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
				order by lane_host_rank,
					"checkpointLedger" asc nulls last,
					target_lane,
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
		where host_rank <= $2::integer
	), ${canonicalFrontierReservationCtesSql}, selected as materialized (
		select candidate.*
		from additions_ranked candidate
		cross join outstanding
		cross join canonical_reservation_state reservation
		where (
			candidate.selected_replaceable_id is not null
			or candidate.addition_rank <= greatest(
				${historyArchiveMinimumWatermark}::integer - outstanding.count, 0
			)
		)
			and candidate.candidate_replacement_rank <= greatest(
				$1::integer - reservation.count, 0
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
			"executionReason" = case generic."executionReason"
				when 'proof-completion-reserve'
					then 'proof-completion-waiting'
				else 'frontier-waiting'
			end,
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
