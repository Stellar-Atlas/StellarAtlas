import {
	ledgerFactsJsonSql,
	resultsFactsJsonSql,
	transactionsFactsJsonSql
} from './HistoryArchiveCheckpointProofSqlInputs.js';
import { historyArchiveCheckpointProofUpsertSql } from './HistoryArchiveCheckpointProofUpsertSql.js';
import { historyArchiveCheckpointProofFailureCtesSql } from './HistoryArchiveCheckpointProofFailureSql.js';
import { historyArchiveCheckpointProofTargetCtesSql } from './HistoryArchiveCheckpointProofTargetSql.js';

export const historyArchiveCheckpointProofRefreshSql = `
	with ${historyArchiveCheckpointProofTargetCtesSql}, checkpoint_rollup as (
		select
			target."archiveUrlIdentity",
			target."checkpointLedger",
			min(object."archiveUrl") as "archiveUrl",
			bool_or(object.status = 'scanning'
				and object."objectType" <> 'scp') as has_active,
			bool_or(object."objectType" = 'checkpoint-state'
				and object.status = 'verified') as has_checkpoint_state,
			bool_or(object."objectType" = 'ledger'
				and object.status = 'verified') as has_ledger,
			bool_or(object."objectType" = 'transactions'
				and object.status = 'verified') as has_transactions,
			bool_or(object."objectType" = 'results'
				and object.status = 'verified') as has_results,
			bool_or(object."objectType" = 'scp'
				and object.status = 'verified') as has_scp,
			count(*) filter (where object."objectType" = 'checkpoint-state')
				as checkpoint_state_object_count,
			count(*) filter (where object."objectType" = 'ledger')
				as ledger_object_count,
			count(*) filter (where object."objectType" = 'transactions')
				as transactions_object_count,
			count(*) filter (where object."objectType" = 'results')
				as results_object_count,
			count(*) filter (where object."objectType" = 'scp')
				as scp_object_count,
			bool_or(object."objectType" = 'scp'
				and object.status = 'verified'
				and object."verificationFacts"#>>'{scpCategory,sourceUrl}' =
					object."objectUrl") as scp_source_matches,
			max(case when object."objectType" = 'scp'
				and object."verificationFacts"#>>'{scpCategory,entryCount}' ~ '^[0-9]+$'
				then (object."verificationFacts"#>>'{scpCategory,entryCount}')::integer
			end) as scp_entry_count,
			(max(object."remoteId"::text) filter (
				where object."objectType" = 'checkpoint-state'))::uuid
				as "checkpointStateObjectRemoteId",
			(max(object."remoteId"::text) filter (
				where object."objectType" = 'ledger'))::uuid
				as "ledgerObjectRemoteId",
			(max(object."remoteId"::text) filter (
				where object."objectType" = 'transactions'))::uuid
				as "transactionsObjectRemoteId",
			(max(object."remoteId"::text) filter (
				where object."objectType" = 'results'))::uuid
				as "resultsObjectRemoteId",
			(max(object."remoteId"::text) filter (
				where object."objectType" = 'scp'))::uuid as "scpObjectRemoteId"
		from target_checkpoints target
		left join "history_archive_object_queue" object
			on object."archiveUrlIdentity" = target."archiveUrlIdentity"
			and object."checkpointLedger" = target."checkpointLedger"
		group by target."archiveUrlIdentity", target."checkpointLedger"
	), checkpoint_state_facts as (
		select
			object."archiveUrlIdentity",
			object."checkpointLedger",
			case
				when object."verificationFacts"#>>
					'{checkpointHistoryArchiveStateFact,checkpointLedger}' ~ '^[0-9]+$'
				then (object."verificationFacts"#>>
					'{checkpointHistoryArchiveStateFact,checkpointLedger}')::bigint
			end as payload_checkpoint_ledger,
			object."verificationFacts"#>>
				'{checkpointHistoryArchiveStateFact,bucketListHash}' as bucket_list_hash,
			coalesce(
				object."verificationFacts"#>>
					'{checkpointHistoryArchiveStateFact,networkPassphrase}',
				object."verificationFacts"#>>
					'{checkpointHistoryArchiveState,stellarHistory,networkPassphrase}',
				object."completionArchiveMetadata"#>>'{stellarHistory,networkPassphrase}'
			) as network_passphrase,
			(
				object."verificationFacts"#>>
					'{checkpointHistoryArchiveStateFact,stellarHistoryUrl}' =
						object."objectUrl"
				and object."verificationFacts"#>>
					'{checkpointHistoryArchiveState,stellarHistoryUrl}' =
						object."objectUrl"
			) as source_matches
		from "history_archive_object_queue" object
		join target_checkpoints target
			on target."archiveUrlIdentity" = object."archiveUrlIdentity"
			and target."checkpointLedger" = object."checkpointLedger"
		where object."objectType" = 'checkpoint-state'
			and object.status = 'verified'
	), expected_bucket_hashes as (
		select dependency.*
		from "history_archive_checkpoint_bucket_dependency" dependency
		join target_checkpoints target
			on target."archiveUrlIdentity" = dependency."archiveUrlIdentity"
			and target."checkpointLedger" = dependency."checkpointLedger"
	), target_category_sources as (
		select
			range."archiveUrlIdentity",
			range."checkpointLedger",
			range.first_expected_ledger,
			range.last_expected_ledger,
			object."objectType",
			case object."objectType"
				when 'ledger' then ${ledgerFactsJsonSql}
				when 'transactions' then ${transactionsFactsJsonSql}
				else ${resultsFactsJsonSql}
			end as facts,
			case
				when object."verificationFacts"#>>
					(array[object."objectType" || 'Category', 'entryCount']) ~ '^[0-9]+$'
				then (object."verificationFacts"#>>
					(array[object."objectType" || 'Category', 'entryCount']))::integer
			end as entry_count,
			(object."verificationFacts"#>>
				(array[object."objectType" || 'Category', 'sourceUrl'])
					= object."objectUrl") as source_matches
		from expected_checkpoint_ranges range
		join "history_archive_object_queue" object
			on object."archiveUrlIdentity" = range."archiveUrlIdentity"
			and object."checkpointLedger" = range."checkpointLedger"
			and object."objectType" in ('ledger', 'transactions', 'results')
			and object.status = 'verified'
	), category_validation as (
		select
			source."archiveUrlIdentity",
			source."checkpointLedger",
			source."objectType",
			source.entry_count,
			bool_and(source.source_matches) as source_matches,
			jsonb_array_length(source.facts) as raw_fact_count,
			count(fact.value)::bigint as fact_count,
			count(distinct (fact.value->>'ledger')::bigint)::bigint
				as distinct_ledger_count,
			count(fact.value) filter (where (fact.value->>'ledger')::bigint
				between source.first_expected_ledger and source.last_expected_ledger)
				as in_range_count,
			min((fact.value->>'ledger')::bigint) as first_ledger,
			max((fact.value->>'ledger')::bigint) as last_ledger
		from target_category_sources source
		left join lateral jsonb_array_elements(source.facts) fact on true
		group by source."archiveUrlIdentity", source."checkpointLedger",
			source."objectType", source.entry_count, source.facts
	), ledger_by_sequence as (
		select
			source."archiveUrlIdentity", source."checkpointLedger",
			source.first_expected_ledger, source.last_expected_ledger,
			(fact->>'ledger')::bigint as ledger,
			min(fact->>'ledgerHeaderHash') as ledger_header_hash,
			min(fact->>'previousLedgerHeaderHash') as previous_ledger_header_hash,
			min(fact->>'transactionSetHash') as transaction_set_hash,
			min(fact->>'transactionResultSetHash') as transaction_result_hash,
			min(fact->>'bucketListHash') as bucket_list_hash,
			max((fact->>'protocolVersion')::integer) as protocol_version
		from target_category_sources source
		cross join lateral jsonb_array_elements(source.facts) fact
		where source."objectType" = 'ledger'
		group by source."archiveUrlIdentity", source."checkpointLedger",
			source.first_expected_ledger, source.last_expected_ledger,
			(fact->>'ledger')::bigint
	), hash_by_sequence as (
		select source."archiveUrlIdentity", source."checkpointLedger",
			source."objectType", (fact->>'ledger')::bigint as ledger,
			min(fact->>'hash') as hash
		from target_category_sources source
		cross join lateral jsonb_array_elements(source.facts) fact
		where source."objectType" in ('transactions', 'results')
		group by source."archiveUrlIdentity", source."checkpointLedger",
			source."objectType", (fact->>'ledger')::bigint
	), previous_boundary as (
		select
			range."archiveUrlIdentity", range."checkpointLedger",
			count(fact.value)::integer as boundary_fact_count,
			count(distinct fact.value->>'ledgerHeaderHash')::integer
				as boundary_hash_count,
			max(fact.value->>'ledgerHeaderHash') as boundary_hash
		from expected_checkpoint_ranges range
		left join "history_archive_object_queue" object
			on object."archiveUrlIdentity" = range."archiveUrlIdentity"
			and object."checkpointLedger" = range."checkpointLedger" - 64
			and object."objectType" = 'ledger'
			and object.status = 'verified'
		left join lateral jsonb_array_elements(${ledgerFactsJsonSql}) fact
			on (fact.value->>'ledger')::bigint = range.first_expected_ledger - 1
		group by range."archiveUrlIdentity", range."checkpointLedger"
	), ledger_chain as (
		select ledger.*,
			lag(ledger_header_hash) over (
				partition by "archiveUrlIdentity", "checkpointLedger"
				order by ledger
			) as previous_fact_hash
		from ledger_by_sequence ledger
	), chain_rollup as (
		select
			ledger."archiveUrlIdentity", ledger."checkpointLedger",
			max(state.bucket_list_hash) as checkpoint_bucket_list_hash,
			max(state.network_passphrase) as network_passphrase,
			max(ledger.protocol_version) as max_protocol_version,
			bool_or(state.source_matches) as checkpoint_source_matches,
			bool_or(state.payload_checkpoint_ledger is not null)
				as has_checkpoint_ledger_fact,
			bool_or(state.payload_checkpoint_ledger = ledger."checkpointLedger")
				as checkpoint_ledger_matches,
			max(ledger.bucket_list_hash) filter (
				where ledger.ledger = ledger."checkpointLedger")
				as ledger_bucket_list_hash,
			bool_or(ledger.ledger = ledger."checkpointLedger"
				and ledger.bucket_list_hash = state.bucket_list_hash)
				as checkpoint_bucket_matches,
			bool_or(state.bucket_list_hash is not null) as has_checkpoint_bucket_fact,
			bool_and(coalesce(ledger.transaction_set_hash = transactions.hash, false))
				as transactions_match,
			bool_and(coalesce(ledger.transaction_result_hash = results.hash, false))
				as results_match,
			bool_and(case
				when ledger.ledger = ledger.first_expected_ledger then
					ledger."checkpointLedger" = 63 or (
						previous.boundary_fact_count = 1
						and previous.boundary_hash_count = 1
						and ledger.previous_ledger_header_hash = previous.boundary_hash
					)
				else ledger.previous_ledger_header_hash = ledger.previous_fact_hash
			end) as previous_ledgers_match,
			bool_or(ledger."checkpointLedger" > 63
				and previous.boundary_fact_count = 0) as predecessor_missing,
			bool_and(ledger."checkpointLedger" = 63 or (
				previous.boundary_fact_count = 1
				and previous.boundary_hash_count = 1
			)) as predecessor_boundary_valid
		from ledger_chain ledger
		left join hash_by_sequence transactions
			on transactions."archiveUrlIdentity" = ledger."archiveUrlIdentity"
			and transactions."checkpointLedger" = ledger."checkpointLedger"
			and transactions."objectType" = 'transactions'
			and transactions.ledger = ledger.ledger
		left join hash_by_sequence results
			on results."archiveUrlIdentity" = ledger."archiveUrlIdentity"
			and results."checkpointLedger" = ledger."checkpointLedger"
			and results."objectType" = 'results'
			and results.ledger = ledger.ledger
		left join checkpoint_state_facts state
			on state."archiveUrlIdentity" = ledger."archiveUrlIdentity"
			and state."checkpointLedger" = ledger."checkpointLedger"
		join previous_boundary previous
			on previous."archiveUrlIdentity" = ledger."archiveUrlIdentity"
			and previous."checkpointLedger" = ledger."checkpointLedger"
		group by ledger."archiveUrlIdentity", ledger."checkpointLedger"
	), category_rollup as (
		select
			range."archiveUrlIdentity", range."checkpointLedger",
			range.expected_ledger_count,
			bool_and(range."checkpointLedger" % 64 = 63) as checkpoint_boundary_valid,
			max(validation.distinct_ledger_count) filter (
				where validation."objectType" = 'ledger') as ledger_fact_count,
			max(validation.distinct_ledger_count) filter (
				where validation."objectType" = 'transactions') as transaction_fact_count,
			max(validation.distinct_ledger_count) filter (
				where validation."objectType" = 'results') as result_fact_count,
			max(validation.raw_fact_count) filter (
				where validation."objectType" = 'ledger') as ledger_raw_fact_count,
			max(validation.raw_fact_count) filter (
				where validation."objectType" = 'transactions')
				as transaction_raw_fact_count,
			max(validation.raw_fact_count) filter (
				where validation."objectType" = 'results') as result_raw_fact_count,
			bool_or(validation.entry_count = range.expected_ledger_count
				and validation.source_matches
				and validation.raw_fact_count = range.expected_ledger_count
				and validation.fact_count = range.expected_ledger_count
				and validation.distinct_ledger_count = range.expected_ledger_count
				and validation.in_range_count = range.expected_ledger_count
				and validation.first_ledger = range.first_expected_ledger
				and validation.last_ledger = range.last_expected_ledger
			) filter (where validation."objectType" = 'ledger') as ledger_exact,
			bool_or(validation.entry_count = range.expected_ledger_count
				and validation.source_matches
				and validation.raw_fact_count = range.expected_ledger_count
				and validation.fact_count = range.expected_ledger_count
				and validation.distinct_ledger_count = range.expected_ledger_count
				and validation.in_range_count = range.expected_ledger_count
				and validation.first_ledger = range.first_expected_ledger
				and validation.last_ledger = range.last_expected_ledger
			) filter (where validation."objectType" = 'transactions')
				as transactions_exact,
			bool_or(validation.entry_count = range.expected_ledger_count
				and validation.source_matches
				and validation.raw_fact_count = range.expected_ledger_count
				and validation.fact_count = range.expected_ledger_count
				and validation.distinct_ledger_count = range.expected_ledger_count
				and validation.in_range_count = range.expected_ledger_count
				and validation.first_ledger = range.first_expected_ledger
				and validation.last_ledger = range.last_expected_ledger
			) filter (where validation."objectType" = 'results') as results_exact
		from expected_checkpoint_ranges range
		left join category_validation validation
			on validation."archiveUrlIdentity" = range."archiveUrlIdentity"
			and validation."checkpointLedger" = range."checkpointLedger"
		group by range."archiveUrlIdentity", range."checkpointLedger",
			range.expected_ledger_count
	), bucket_rollup as (
		select
			expected."archiveUrlIdentity", expected."checkpointLedger",
			count(distinct expected."bucketHash") as expected_bucket_count,
			count(distinct bucket."bucketHash") filter (
				where bucket.status = 'verified'
					and bucket."verificationFacts"#>>'{bucketObject,matched}' = 'true'
					and lower(bucket."verificationFacts"#>>
						'{bucketObject,expectedBucketHash}') = expected."bucketHash"
					and bucket."verificationFacts"#>>'{bucketObject,sourceUrl}' =
						bucket."objectUrl"
			) as verified_bucket_count,
			count(distinct bucket."bucketHash") filter (
				where bucket.status = 'failed') as failed_bucket_count
		from expected_bucket_hashes expected
		left join "history_archive_object_queue" bucket
			on bucket."archiveUrlIdentity" = expected."archiveUrlIdentity"
			and bucket."objectType" = 'bucket'
			and bucket."bucketHash" = expected."bucketHash"
		group by expected."archiveUrlIdentity", expected."checkpointLedger"
	), ${historyArchiveCheckpointProofFailureCtesSql}, proof_rollup as (
		select category.*,
			chain.checkpoint_bucket_list_hash, chain.network_passphrase,
			chain.max_protocol_version, chain.ledger_bucket_list_hash,
			coalesce(chain.checkpoint_source_matches, false)
				as checkpoint_source_matches,
			coalesce(chain.has_checkpoint_ledger_fact, false)
				as has_checkpoint_ledger_fact,
			coalesce(chain.checkpoint_ledger_matches, false)
				as checkpoint_ledger_matches,
			coalesce(chain.checkpoint_bucket_matches, false) as checkpoint_bucket_matches,
			coalesce(chain.has_checkpoint_bucket_fact, false) as has_checkpoint_bucket_fact,
			coalesce(chain.transactions_match, false) as transactions_match,
			coalesce(chain.results_match, false) as results_match,
			coalesce(chain.previous_ledgers_match, false) as previous_ledgers_match,
			coalesce(chain.predecessor_missing, category."checkpointLedger" > 63)
				as predecessor_missing,
			coalesce(chain.predecessor_boundary_valid, false)
				as predecessor_boundary_valid
		from category_rollup category
		left join chain_rollup chain
			on chain."archiveUrlIdentity" = category."archiveUrlIdentity"
			and chain."checkpointLedger" = category."checkpointLedger"
	), classified as (
		select checkpoint_rollup.*,
			(failure.object_failures is not null) as has_failed,
			checkpoint_rollup.scp_object_count > 0 as scp_present,
			(checkpoint_rollup.has_scp
				and coalesce(checkpoint_rollup.scp_entry_count, 0) > 0
				and coalesce(checkpoint_rollup.scp_source_matches, false))
				as scp_verified,
			proof_rollup.network_passphrase, proof_rollup.max_protocol_version,
			failure.failure_error_type, failure.failure_channel,
			failure.failure_http_status,
			failure.failure_channels,
			failure.object_failures,
			proof_rollup.expected_ledger_count,
			coalesce(proof_rollup.ledger_raw_fact_count, 0) as ledger_raw_fact_count,
			coalesce(proof_rollup.transaction_raw_fact_count, 0)
				as transaction_raw_fact_count,
			coalesce(proof_rollup.result_raw_fact_count, 0) as result_raw_fact_count,
			coalesce(proof_rollup.ledger_fact_count, 0) as ledger_fact_count,
			coalesce(proof_rollup.transaction_fact_count, 0) as transaction_fact_count,
			coalesce(proof_rollup.result_fact_count, 0) as result_fact_count,
			coalesce(bucket.expected_bucket_count, 0) as expected_bucket_count,
			coalesce(bucket.verified_bucket_count, 0) as verified_bucket_count,
			coalesce(bucket.failed_bucket_count, 0) as failed_bucket_count,
			greatest(coalesce(bucket.expected_bucket_count, 0)
				- coalesce(bucket.verified_bucket_count, 0), 0) as missing_bucket_count,
			proof_rollup.checkpoint_source_matches,
			proof_rollup.has_checkpoint_ledger_fact,
			proof_rollup.checkpoint_ledger_matches,
			proof_rollup.checkpoint_bucket_list_hash,
			proof_rollup.ledger_bucket_list_hash,
			proof_rollup.predecessor_missing,
			proof_rollup.predecessor_boundary_valid,
			(failure.object_failures is null
				and checkpoint_rollup.has_checkpoint_state
				and checkpoint_rollup.has_ledger
				and checkpoint_rollup.has_transactions
				and checkpoint_rollup.has_results
				and checkpoint_rollup.checkpoint_state_object_count = 1
				and checkpoint_rollup.ledger_object_count = 1
				and checkpoint_rollup.transactions_object_count = 1
				and checkpoint_rollup.results_object_count = 1)
				as required_objects_complete,
			(coalesce(proof_rollup.ledger_exact, false)
				and coalesce(proof_rollup.transactions_exact, false)
				and coalesce(proof_rollup.results_exact, false)
				and proof_rollup.checkpoint_source_matches
				and proof_rollup.has_checkpoint_ledger_fact
				and proof_rollup.checkpoint_ledger_matches
				and coalesce(proof_rollup.checkpoint_boundary_valid, false)
				and proof_rollup.has_checkpoint_bucket_fact
				and proof_rollup.predecessor_boundary_valid)
				as proof_facts_complete,
			proof_rollup.checkpoint_bucket_matches as checkpoint_bucket_list_matches,
			proof_rollup.transactions_match, proof_rollup.results_match,
			proof_rollup.previous_ledgers_match,
			(coalesce(bucket.expected_bucket_count, 0) > 0
				and bucket.expected_bucket_count = bucket.verified_bucket_count
				and coalesce(bucket.failed_bucket_count, 0) = 0) as buckets_verified
		from checkpoint_rollup
		join proof_rollup
			on proof_rollup."archiveUrlIdentity" = checkpoint_rollup."archiveUrlIdentity"
			and proof_rollup."checkpointLedger" = checkpoint_rollup."checkpointLedger"
		left join bucket_rollup bucket
			on bucket."archiveUrlIdentity" = checkpoint_rollup."archiveUrlIdentity"
			and bucket."checkpointLedger" = checkpoint_rollup."checkpointLedger"
		left join failure_rollup failure
			on failure."archiveUrlIdentity" = checkpoint_rollup."archiveUrlIdentity"
			and failure."checkpointLedger" = checkpoint_rollup."checkpointLedger"
	), finalized as (
		select *, case
			when has_failed then 'not-evaluable'
			when not required_objects_complete or has_active then 'pending'
			when predecessor_missing then 'pending'
			when has_checkpoint_ledger_fact and not checkpoint_ledger_matches
				then 'mismatch'
			when not proof_facts_complete then 'not-evaluable'
			when not (checkpoint_bucket_list_matches and transactions_match
				and results_match and previous_ledgers_match) then 'mismatch'
			when not buckets_verified then 'not-evaluable'
			else 'verified'
		end as status, case
			when has_failed then 'object-failed'
			when not required_objects_complete or has_active then 'object-incomplete'
			when predecessor_missing then 'predecessor-missing'
			when has_checkpoint_ledger_fact and not checkpoint_ledger_matches
				then 'checkpoint-ledger-mismatch'
			when not proof_facts_complete then 'proof-facts-incomplete'
			when not checkpoint_bucket_list_matches
				then 'checkpoint-bucket-list-mismatch'
			when not transactions_match then 'transaction-hash-mismatch'
			when not results_match then 'result-hash-mismatch'
			when not previous_ledgers_match then 'previous-ledger-hash-mismatch'
			when not buckets_verified then 'bucket-missing'
			else null
		end as failure_kind
		from classified
	)
	${historyArchiveCheckpointProofUpsertSql}
`;
