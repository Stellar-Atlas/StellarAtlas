export const materializeCanonicalFrontierDependenciesSql = `
	with runtime_target as materialized (
		select "network_passphrase_hash", "checkpoint_ledger"::integer
			as checkpoint_ledger
		from "full_history_promotion_runtime"
		where state in ('promoting', 'waiting-for-proof')
			and "checkpoint_ledger" is not null
	), checkpoints as materialized (
		select checkpoint.*
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
	), category_targets as materialized (
		select checkpoint."archiveUrlIdentity", desired.object_type,
			desired.checkpoint_ledger, desired.object_key
		from checkpoints checkpoint
		cross join lateral (
			values
				(
					'ledger', checkpoint."checkpointLedger" - 64,
					'ledger:' || lpad(
						to_hex(checkpoint."checkpointLedger" - 64), 8, '0'
					), 0
				),
				(
					'ledger', checkpoint."checkpointLedger",
					'ledger:' || lpad(to_hex(checkpoint."checkpointLedger"), 8, '0'),
					1
				),
				(
					'transactions', checkpoint."checkpointLedger",
					'transactions:' || lpad(
						to_hex(checkpoint."checkpointLedger"), 8, '0'
					), 2
				),
				(
					'results', checkpoint."checkpointLedger",
					'results:' || lpad(
						to_hex(checkpoint."checkpointLedger"), 8, '0'
					), 3
				),
				(
					'scp', checkpoint."checkpointLedger",
					'scp:' || lpad(to_hex(checkpoint."checkpointLedger"), 8, '0'), 4
				)
		) desired(object_type, checkpoint_ledger, object_key, object_priority)
		where desired.object_priority > 0
			or (
				checkpoint."checkpointLedger" > 63
				and exists (
					select 1
					from "history_archive_object_queue" predecessor
					where predecessor."archiveUrlIdentity" =
						checkpoint."archiveUrlIdentity"
						and predecessor."objectType" = 'checkpoint-state'
						and predecessor."objectKey" = 'checkpoint-state:' || lpad(
							to_hex(checkpoint."checkpointLedger" - 64), 8, '0'
						)
						and predecessor.status = 'verified'
				)
			)
	), inserted as (
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
		returning checkpoint.id
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
		returning candidate.id
	)
	select
		(select count(*)::integer from inserted) as inserted,
		(select count(*)::integer from marked) as marked,
		(select count(*)::integer from activated_categories) +
			(select count(*)::integer from activated_buckets) as activated
`;

export const admitCanonicalFrontierSql = `
	with runtime_target as materialized (
		select "network_passphrase_hash", "checkpoint_ledger"::integer
			as checkpoint_ledger
		from "full_history_promotion_runtime"
		where state in ('promoting', 'waiting-for-proof')
			and "checkpoint_ledger" is not null
	), network_roots as materialized (
		select state."archiveUrlIdentity", target.checkpoint_ledger,
			root."lastClaimedAt"
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
			and checkpoint.status = 'verified'
	), category_objects as materialized (
		select network_root."archiveUrlIdentity",
			network_root."lastClaimedAt", desired.object_type,
			desired.checkpoint_ledger as object_checkpoint_ledger,
			desired.object_key, desired.object_priority
		from network_roots network_root
		cross join lateral (
			values
				(
					'ledger', network_root.checkpoint_ledger - 64,
					'ledger:' || lpad(
						to_hex(network_root.checkpoint_ledger - 64), 8, '0'
					), 0
				),
				(
					'ledger', network_root.checkpoint_ledger,
					'ledger:' || lpad(to_hex(network_root.checkpoint_ledger), 8, '0'),
					1
				),
				(
					'transactions', network_root.checkpoint_ledger,
					'transactions:' || lpad(
						to_hex(network_root.checkpoint_ledger), 8, '0'
					), 2
				),
				(
					'results', network_root.checkpoint_ledger,
					'results:' || lpad(
						to_hex(network_root.checkpoint_ledger), 8, '0'
					), 3
				),
				(
					'scp', network_root.checkpoint_ledger,
					'scp:' || lpad(to_hex(network_root.checkpoint_ledger), 8, '0'), 4
				)
		) desired(object_type, checkpoint_ledger, object_key, object_priority)
		where desired.checkpoint_ledger >= 63
	), bucket_objects as materialized (
		select network_root."archiveUrlIdentity",
			network_root."lastClaimedAt", 'bucket'::text as object_type,
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
		select candidate.id, candidate."archiveUrlIdentity",
			candidate."hostIdentity", candidate."objectKey",
			candidate."checkpointLedger", desired.object_priority,
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
	), root_ranked as materialized (
		select candidates.*,
			row_number() over (
				partition by "archiveUrlIdentity"
				order by object_priority, "objectKey", id
			) as root_rank
		from candidates
	), host_ranked as materialized (
		select root_ranked.*,
			row_number() over (
				partition by "hostIdentity"
				order by "lastClaimedAt" asc nulls first,
					"archiveUrlIdentity", object_priority, id
			) as host_rank
		from root_ranked
		where root_rank = 1
	), additions_ranked as materialized (
		select host_ranked.*,
			count(*) filter (where replaceable_id is null) over (
				order by "lastClaimedAt" asc nulls first,
					"archiveUrlIdentity", id
			) as addition_rank
		from host_ranked
		where host_rank <= greatest($3::integer - host_active, 0)
	), selected as materialized (
		select candidate.*
		from additions_ranked candidate
		cross join outstanding
		where candidate.replaceable_id is not null
			or candidate.addition_rank <= greatest(
				$2::integer - outstanding.count, 0
			)
		order by (candidate.replaceable_id is not null) desc,
			candidate."lastClaimedAt" asc nulls first,
			candidate."archiveUrlIdentity", candidate.id
		limit $1::integer
	), demoted as (
		update "history_archive_object_queue" generic
		set "executionDisposition" = 'deferred',
			"executionReason" = 'frontier-waiting',
			"executionDispositionAt" = now()
		from selected
		where generic.id = selected.replaceable_id
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
