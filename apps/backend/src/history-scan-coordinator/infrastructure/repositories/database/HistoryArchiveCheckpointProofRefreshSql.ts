import type { HistoryArchiveCheckpointProofRefreshTarget } from '@history-scan-coordinator/domain/history-archive-checkpoint-proof/HistoryArchiveCheckpointProofRepository.js';

export function toHistoryArchiveCheckpointProofRefreshParams(
	target: HistoryArchiveCheckpointProofRefreshTarget
): readonly [string, number | null, string | null] {
	return [
		target.archiveUrlIdentity,
		target.checkpointLedger ?? null,
		target.bucketHash ?? null
	];
}

const ledgerFactsJsonSql = `
	coalesce(
		"verificationFacts"->'ledgerCategory'->'ledgers',
		'[]'::jsonb
	)
`;

const transactionsFactsJsonSql = `
	coalesce(
		"verificationFacts"->'transactionsCategory'->'ledgers',
		'[]'::jsonb
	)
`;

const resultsFactsJsonSql = `
	coalesce(
		"verificationFacts"->'resultsCategory'->'ledgers',
		'[]'::jsonb
	)
`;

const archiveObjectFilterSql =
	'"archiveUrlIdentity" = $1::text and "checkpointLedger" is not null';

export const historyArchiveCheckpointProofRefreshSql = `
	with checkpoint_state_objects as (
		select *
		from history_archive_object_queue
		where "archiveUrlIdentity" = $1::text
			and "objectType" = 'checkpoint-state'
			and status = 'verified'
			and "checkpointLedger" is not null
	),
	expected_bucket_hashes as (
		select distinct
			object."archiveUrl",
			object."archiveUrlIdentity",
			object."checkpointLedger",
			lower(hash.value) as "bucketHash"
		from checkpoint_state_objects object
		cross join lateral jsonb_array_elements(
			coalesce(
				object."verificationFacts"
					->'checkpointHistoryArchiveState'
					->'stellarHistory'
					->'currentBuckets',
				'[]'::jsonb
			)
			|| coalesce(
				object."verificationFacts"
					->'checkpointHistoryArchiveState'
					->'stellarHistory'
					->'hotArchiveBuckets',
				'[]'::jsonb
			)
		) bucket
		cross join lateral (
			values
				(bucket->>'curr'),
				(bucket->>'snap'),
				(bucket->'next'->>'output')
		) hash(value)
		where hash.value is not null
			and lower(hash.value) ~ '^[0-9a-f]{64}$'
			and lower(hash.value) !~ '^0+$'
	),
	target_checkpoints as (
		select distinct
			"archiveUrlIdentity",
			"checkpointLedger"
		from history_archive_object_queue
		where ${archiveObjectFilterSql}
			and $2::integer is not null
			and "checkpointLedger" = $2::integer
		union
		select distinct
			"archiveUrlIdentity",
			"checkpointLedger"
		from expected_bucket_hashes
		where $3::text is not null
			and "bucketHash" = lower($3::text)
	),
	checkpoint_rollup as (
		select
			target."archiveUrlIdentity",
			target."checkpointLedger",
			min(object."archiveUrl") as "archiveUrl",
			bool_or(object.status = 'failed') as has_failed,
			bool_or(object.status = 'scanning') as has_active,
			bool_or(object."objectType" = 'scp') as expects_scp,
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
			(max(object."remoteId"::text) filter (
				where object."objectType" = 'checkpoint-state'
			))::uuid as "checkpointStateObjectRemoteId",
			(max(object."remoteId"::text) filter (
				where object."objectType" = 'ledger'
			))::uuid as "ledgerObjectRemoteId",
			(max(object."remoteId"::text) filter (
				where object."objectType" = 'transactions'
			))::uuid as "transactionsObjectRemoteId",
			(max(object."remoteId"::text) filter (
				where object."objectType" = 'results'
			))::uuid as "resultsObjectRemoteId",
			(max(object."remoteId"::text) filter (
				where object."objectType" = 'scp'
			))::uuid as "scpObjectRemoteId"
		from target_checkpoints target
		join history_archive_object_queue object
			on object."archiveUrlIdentity" = target."archiveUrlIdentity"
			and object."checkpointLedger" = target."checkpointLedger"
		group by target."archiveUrlIdentity", target."checkpointLedger"
	),
	state_facts as (
		select
			"archiveUrlIdentity",
			"checkpointLedger",
			"verificationFacts"#>>'{checkpointHistoryArchiveStateFact,bucketListHash}'
				as bucket_list_hash
		from checkpoint_state_objects
		where "checkpointLedger" in (
			select "checkpointLedger" from target_checkpoints
		)
	),
	ledger_facts as (
		select
			object."archiveUrlIdentity",
			object."checkpointLedger",
			(fact->>'ledger')::bigint as ledger,
			fact->>'ledgerHeaderHash' as ledger_header_hash,
			fact->>'previousLedgerHeaderHash' as previous_ledger_header_hash,
			fact->>'transactionSetHash' as transaction_set_hash,
			fact->>'transactionResultSetHash' as transaction_result_hash,
			fact->>'bucketListHash' as bucket_list_hash
		from history_archive_object_queue object
		join target_checkpoints target
			on target."archiveUrlIdentity" = object."archiveUrlIdentity"
			and target."checkpointLedger" = object."checkpointLedger"
		cross join lateral jsonb_array_elements(${ledgerFactsJsonSql}) fact
		where object."objectType" = 'ledger'
			and object.status = 'verified'
	),
	ledger_chain as (
		select
			ledger_facts.*,
			lag(ledger_header_hash) over (
				partition by "archiveUrlIdentity", "checkpointLedger"
				order by ledger
			) as previous_fact_hash,
			min(ledger) over (
				partition by "archiveUrlIdentity", "checkpointLedger"
			) as first_ledger
		from ledger_facts
	),
	transaction_facts as (
		select
			object."archiveUrlIdentity",
			object."checkpointLedger",
			(fact->>'ledger')::bigint as ledger,
			fact->>'hash' as hash
		from history_archive_object_queue object
		join target_checkpoints target
			on target."archiveUrlIdentity" = object."archiveUrlIdentity"
			and target."checkpointLedger" = object."checkpointLedger"
		cross join lateral jsonb_array_elements(${transactionsFactsJsonSql}) fact
		where object."objectType" = 'transactions'
			and object.status = 'verified'
	),
	result_facts as (
		select
			object."archiveUrlIdentity",
			object."checkpointLedger",
			(fact->>'ledger')::bigint as ledger,
			fact->>'hash' as hash
		from history_archive_object_queue object
		join target_checkpoints target
			on target."archiveUrlIdentity" = object."archiveUrlIdentity"
			and target."checkpointLedger" = object."checkpointLedger"
		cross join lateral jsonb_array_elements(${resultsFactsJsonSql}) fact
		where object."objectType" = 'results'
			and object.status = 'verified'
	),
	proof_rollup as (
		select
			ledger_chain."archiveUrlIdentity",
			ledger_chain."checkpointLedger",
			count(*) as ledger_fact_count,
			count(transaction_facts.hash) as transaction_fact_count,
			count(result_facts.hash) as result_fact_count,
			max(state_facts.bucket_list_hash) as checkpoint_bucket_list_hash,
			max(ledger_chain.bucket_list_hash) filter (
				where ledger_chain.ledger = ledger_chain."checkpointLedger"
			) as ledger_bucket_list_hash,
			bool_or(
				ledger_chain.ledger = ledger_chain."checkpointLedger"
				and ledger_chain.bucket_list_hash = state_facts.bucket_list_hash
			) as checkpoint_bucket_matches,
			bool_or(state_facts.bucket_list_hash is not null)
				as has_checkpoint_bucket_fact,
			bool_and(coalesce(
				ledger_chain.transaction_set_hash = transaction_facts.hash,
				false
			)) as transactions_match,
			bool_and(coalesce(
				ledger_chain.transaction_result_hash = result_facts.hash,
				false
			)) as results_match,
			bool_and(
				ledger_chain.ledger = ledger_chain.first_ledger
				or coalesce(
					ledger_chain.previous_ledger_header_hash =
						ledger_chain.previous_fact_hash,
					false
				)
			) as previous_ledgers_match
		from ledger_chain
		left join transaction_facts
			on transaction_facts."archiveUrlIdentity" =
				ledger_chain."archiveUrlIdentity"
			and transaction_facts."checkpointLedger" =
				ledger_chain."checkpointLedger"
			and transaction_facts.ledger = ledger_chain.ledger
		left join result_facts
			on result_facts."archiveUrlIdentity" = ledger_chain."archiveUrlIdentity"
			and result_facts."checkpointLedger" = ledger_chain."checkpointLedger"
			and result_facts.ledger = ledger_chain.ledger
		left join state_facts
			on state_facts."archiveUrlIdentity" = ledger_chain."archiveUrlIdentity"
			and state_facts."checkpointLedger" = ledger_chain."checkpointLedger"
		group by ledger_chain."archiveUrlIdentity", ledger_chain."checkpointLedger"
	),
	bucket_rollup as (
		select
			expected."archiveUrlIdentity",
			expected."checkpointLedger",
			count(distinct expected."bucketHash") as expected_bucket_count,
			count(distinct bucket."bucketHash") filter (
				where bucket.status = 'verified'
			) as verified_bucket_count,
			count(distinct bucket."bucketHash") filter (
				where bucket.status = 'failed'
			) as failed_bucket_count
		from expected_bucket_hashes expected
		join target_checkpoints target
			on target."archiveUrlIdentity" = expected."archiveUrlIdentity"
			and target."checkpointLedger" = expected."checkpointLedger"
		left join history_archive_object_queue bucket
			on bucket."archiveUrlIdentity" = expected."archiveUrlIdentity"
			and bucket."objectType" = 'bucket'
			and bucket."bucketHash" = expected."bucketHash"
		group by expected."archiveUrlIdentity", expected."checkpointLedger"
	),
	classified as (
		select
			checkpoint_rollup.*,
			coalesce(proof_rollup.ledger_fact_count, 0) as ledger_fact_count,
			coalesce(
				proof_rollup.transaction_fact_count,
				0
			) as transaction_fact_count,
			coalesce(proof_rollup.result_fact_count, 0) as result_fact_count,
			coalesce(bucket_rollup.expected_bucket_count, 0)
				as expected_bucket_count,
			coalesce(bucket_rollup.verified_bucket_count, 0)
				as verified_bucket_count,
			coalesce(bucket_rollup.failed_bucket_count, 0) as failed_bucket_count,
			greatest(
				coalesce(bucket_rollup.expected_bucket_count, 0)
					- coalesce(bucket_rollup.verified_bucket_count, 0),
				0
			) as missing_bucket_count,
			proof_rollup.checkpoint_bucket_list_hash,
			proof_rollup.ledger_bucket_list_hash,
			(
				not checkpoint_rollup.has_failed
				and checkpoint_rollup.has_checkpoint_state
				and checkpoint_rollup.has_ledger
				and checkpoint_rollup.has_transactions
				and checkpoint_rollup.has_results
				and (
					not checkpoint_rollup.expects_scp
					or checkpoint_rollup.has_scp
				)
			) as required_objects_complete,
			(
				coalesce(proof_rollup.ledger_fact_count, 0) > 0
				and proof_rollup.transaction_fact_count =
					proof_rollup.ledger_fact_count
				and proof_rollup.result_fact_count = proof_rollup.ledger_fact_count
				and coalesce(proof_rollup.has_checkpoint_bucket_fact, false)
			) as proof_facts_complete,
			coalesce(proof_rollup.checkpoint_bucket_matches, false)
				as checkpoint_bucket_list_matches,
			coalesce(proof_rollup.transactions_match, false)
				as transactions_match,
			coalesce(proof_rollup.results_match, false) as results_match,
			coalesce(proof_rollup.previous_ledgers_match, false)
				as previous_ledgers_match,
			(
				coalesce(bucket_rollup.expected_bucket_count, 0) > 0
				and coalesce(bucket_rollup.expected_bucket_count, 0) =
					coalesce(bucket_rollup.verified_bucket_count, 0)
				and coalesce(bucket_rollup.failed_bucket_count, 0) = 0
			) as buckets_verified
		from checkpoint_rollup
		left join proof_rollup
			on proof_rollup."archiveUrlIdentity" =
				checkpoint_rollup."archiveUrlIdentity"
			and proof_rollup."checkpointLedger" =
				checkpoint_rollup."checkpointLedger"
		left join bucket_rollup
			on bucket_rollup."archiveUrlIdentity" =
				checkpoint_rollup."archiveUrlIdentity"
			and bucket_rollup."checkpointLedger" =
				checkpoint_rollup."checkpointLedger"
	),
	finalized as (
		select
			*,
			case
				when has_failed then 'not-evaluable'
				when not required_objects_complete or has_active then 'pending'
				when not proof_facts_complete then 'not-evaluable'
				when not (
					checkpoint_bucket_list_matches
					and transactions_match
					and results_match
					and previous_ledgers_match
				) then 'mismatch'
				when not buckets_verified then 'not-evaluable'
				else 'verified'
			end as status,
			case
				when has_failed then 'object-failed'
				when not required_objects_complete or has_active
					then 'object-incomplete'
				when not proof_facts_complete then 'proof-facts-incomplete'
				when not checkpoint_bucket_list_matches
					then 'checkpoint-bucket-list-mismatch'
				when not transactions_match then 'transaction-hash-mismatch'
				when not results_match then 'result-hash-mismatch'
				when not previous_ledgers_match
					then 'previous-ledger-hash-mismatch'
				when not buckets_verified then 'bucket-missing'
				else null
			end as failure_kind
		from classified
	)
	insert into "history_archive_checkpoint_proof" (
		"archiveUrl",
		"archiveUrlIdentity",
		"checkpointLedger",
		status,
		"proofVersion",
		"requiredObjectsComplete",
		"proofFactsComplete",
		"checkpointBucketListMatches",
		"transactionsMatch",
		"resultsMatch",
		"previousLedgersMatch",
		"bucketsVerified",
		"ledgerFactCount",
		"transactionFactCount",
		"resultFactCount",
		"expectedBucketCount",
		"verifiedBucketCount",
		"failedBucketCount",
		"missingBucketCount",
		"checkpointBucketListHash",
		"ledgerBucketListHash",
		"checkpointStateObjectRemoteId",
		"ledgerObjectRemoteId",
		"transactionsObjectRemoteId",
		"resultsObjectRemoteId",
		"scpObjectRemoteId",
		"failureKind",
		details,
		"evaluatedAt",
		"createdAt",
		"updatedAt"
	)
	select
		"archiveUrl",
		"archiveUrlIdentity",
		"checkpointLedger",
		status,
		1,
		required_objects_complete,
		proof_facts_complete,
		checkpoint_bucket_list_matches,
		transactions_match,
		results_match,
		previous_ledgers_match,
		buckets_verified,
		ledger_fact_count,
		transaction_fact_count,
		result_fact_count,
		expected_bucket_count,
		verified_bucket_count,
		failed_bucket_count,
		missing_bucket_count,
		checkpoint_bucket_list_hash,
		ledger_bucket_list_hash,
		"checkpointStateObjectRemoteId",
		"ledgerObjectRemoteId",
		"transactionsObjectRemoteId",
		"resultsObjectRemoteId",
		"scpObjectRemoteId",
		failure_kind,
		jsonb_build_object(
			'hasActiveObject', has_active,
			'hasFailedObject', has_failed,
			'expectsScp', expects_scp
		),
		now(),
		now(),
		now()
	from finalized
	on conflict ("archiveUrlIdentity", "checkpointLedger")
	do update set
		"archiveUrl" = excluded."archiveUrl",
		status = excluded.status,
		"proofVersion" = excluded."proofVersion",
		"requiredObjectsComplete" = excluded."requiredObjectsComplete",
		"proofFactsComplete" = excluded."proofFactsComplete",
		"checkpointBucketListMatches" =
			excluded."checkpointBucketListMatches",
		"transactionsMatch" = excluded."transactionsMatch",
		"resultsMatch" = excluded."resultsMatch",
		"previousLedgersMatch" = excluded."previousLedgersMatch",
		"bucketsVerified" = excluded."bucketsVerified",
		"ledgerFactCount" = excluded."ledgerFactCount",
		"transactionFactCount" = excluded."transactionFactCount",
		"resultFactCount" = excluded."resultFactCount",
		"expectedBucketCount" = excluded."expectedBucketCount",
		"verifiedBucketCount" = excluded."verifiedBucketCount",
		"failedBucketCount" = excluded."failedBucketCount",
		"missingBucketCount" = excluded."missingBucketCount",
		"checkpointBucketListHash" = excluded."checkpointBucketListHash",
		"ledgerBucketListHash" = excluded."ledgerBucketListHash",
		"checkpointStateObjectRemoteId" =
			excluded."checkpointStateObjectRemoteId",
		"ledgerObjectRemoteId" = excluded."ledgerObjectRemoteId",
		"transactionsObjectRemoteId" =
			excluded."transactionsObjectRemoteId",
		"resultsObjectRemoteId" = excluded."resultsObjectRemoteId",
		"scpObjectRemoteId" = excluded."scpObjectRemoteId",
		"failureKind" = excluded."failureKind",
		details = excluded.details,
		"evaluatedAt" = excluded."evaluatedAt",
		"updatedAt" = now()
`;
