import { CURRENT_HISTORY_ARCHIVE_CHECKPOINT_PROOF_VERSION } from '../../../domain/history-archive-checkpoint-proof/HistoryArchiveCheckpointProof.js';

export const historyArchiveCheckpointProofFinalizedCteSql = `
	finalized as (
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
`;

function buildHistoryArchiveCheckpointProofUpsertSql(
	additionalSameVersionTransitionSql: string
): string {
	return `
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
		${CURRENT_HISTORY_ARCHIVE_CHECKPOINT_PROOF_VERSION},
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
			'expectedLedgerCount', expected_ledger_count,
			'ledgerRawFactCount', ledger_raw_fact_count,
			'ledgerHeaderHashesVerified', ledger_header_hashes_verified,
			'transactionRawFactCount', transaction_raw_fact_count,
			'resultRawFactCount', result_raw_fact_count,
			'predecessorMissing', predecessor_missing,
			'predecessorBoundaryValid', predecessor_boundary_valid,
			'predecessorSubstituted', predecessor_substituted,
			'predecessorSourceArchiveUrlIdentity',
				predecessor_source_archive_url_identity,
			'checkpointStateLedgerFactPresent', has_checkpoint_ledger_fact,
			'checkpointStateLedgerMatches', checkpoint_ledger_matches,
			'scpEntryCount', scp_entry_count,
			'scpExpectationKnown', scp_expectation_known,
			'scpExpected', scp_expected,
			'scpOptional', true,
			'scpPresent', scp_present,
			'scpVerified', scp_verified,
			'hasActiveObject', has_active,
			'hasFailedObject', has_failed,
			'networkPassphrase', network_passphrase,
			'maxProtocolVersion', max_protocol_version,
			'failureErrorType', failure_error_type,
			'failureChannel', failure_channel,
			'failureChannels', coalesce(to_jsonb(failure_channels), '[]'::jsonb),
			'failureHttpStatus', failure_http_status,
			'objectFailures', coalesce(object_failures, '[]'::jsonb)
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
	where excluded."proofVersion" >
		"history_archive_checkpoint_proof"."proofVersion"
		or (
			excluded."proofVersion" =
				"history_archive_checkpoint_proof"."proofVersion"
			and excluded."evaluatedAt" >
				"history_archive_checkpoint_proof"."evaluatedAt"
			and (
				(
					"history_archive_checkpoint_proof".status in (
						'pending', 'not-evaluable'
					)
					and (
						excluded.status <> 'pending'
						or (
							"history_archive_checkpoint_proof".status =
								'not-evaluable'
							and "history_archive_checkpoint_proof"."failureKind" =
								'object-failed'
							and excluded."failureKind" <> 'object-failed'
						)
					)
				)
				or (
					"history_archive_checkpoint_proof".status = 'mismatch'
					and excluded.status in ('mismatch', 'verified')
				)
				or (
					"history_archive_checkpoint_proof".status = 'verified'
					and excluded.status in ('verified', 'mismatch')
				)
				${additionalSameVersionTransitionSql}
			)
			and row(
				excluded."archiveUrl",
				excluded.status,
				excluded."requiredObjectsComplete",
				excluded."proofFactsComplete",
				excluded."checkpointBucketListMatches",
				excluded."transactionsMatch",
				excluded."resultsMatch",
				excluded."previousLedgersMatch",
				excluded."bucketsVerified",
				excluded."ledgerFactCount",
				excluded."transactionFactCount",
				excluded."resultFactCount",
				excluded."expectedBucketCount",
				excluded."verifiedBucketCount",
				excluded."failedBucketCount",
				excluded."missingBucketCount",
				excluded."checkpointBucketListHash",
				excluded."ledgerBucketListHash",
				excluded."checkpointStateObjectRemoteId",
				excluded."ledgerObjectRemoteId",
				excluded."transactionsObjectRemoteId",
				excluded."resultsObjectRemoteId",
				excluded."scpObjectRemoteId",
				excluded."failureKind",
				excluded.details
			) is distinct from row(
				"history_archive_checkpoint_proof"."archiveUrl",
				"history_archive_checkpoint_proof".status,
				"history_archive_checkpoint_proof"."requiredObjectsComplete",
				"history_archive_checkpoint_proof"."proofFactsComplete",
				"history_archive_checkpoint_proof"."checkpointBucketListMatches",
				"history_archive_checkpoint_proof"."transactionsMatch",
				"history_archive_checkpoint_proof"."resultsMatch",
				"history_archive_checkpoint_proof"."previousLedgersMatch",
				"history_archive_checkpoint_proof"."bucketsVerified",
				"history_archive_checkpoint_proof"."ledgerFactCount",
				"history_archive_checkpoint_proof"."transactionFactCount",
				"history_archive_checkpoint_proof"."resultFactCount",
				"history_archive_checkpoint_proof"."expectedBucketCount",
				"history_archive_checkpoint_proof"."verifiedBucketCount",
				"history_archive_checkpoint_proof"."failedBucketCount",
				"history_archive_checkpoint_proof"."missingBucketCount",
				"history_archive_checkpoint_proof"."checkpointBucketListHash",
				"history_archive_checkpoint_proof"."ledgerBucketListHash",
				"history_archive_checkpoint_proof"."checkpointStateObjectRemoteId",
				"history_archive_checkpoint_proof"."ledgerObjectRemoteId",
				"history_archive_checkpoint_proof"."transactionsObjectRemoteId",
				"history_archive_checkpoint_proof"."resultsObjectRemoteId",
				"history_archive_checkpoint_proof"."scpObjectRemoteId",
				"history_archive_checkpoint_proof"."failureKind",
				"history_archive_checkpoint_proof".details
			)
		)
`;
}

const scalarQueuedLeaseSql = `
							and queue."leaseToken" = $5::uuid
							and queue.generation = $6::bigint
							and queue."evidenceUpdatedAt" = $7::timestamptz
`;

// Batch admission already validates and locks the queue lease. Re-scanning
// locked_targets once per conflict makes pending-proof upserts quadratic.
const batchQueuedLeaseSql = '';
const queuedPendingTransitionSql = `
				or (
					"history_archive_checkpoint_proof".status = 'pending'
					and excluded.status = 'pending'
					and "history_archive_checkpoint_proof"."proofVersion" =
						${CURRENT_HISTORY_ARCHIVE_CHECKPOINT_PROOF_VERSION}
					and (
						"history_archive_checkpoint_proof".
							"checkpointStateObjectRemoteId" is null
						or "history_archive_checkpoint_proof".
							"checkpointStateObjectRemoteId" =
							excluded."checkpointStateObjectRemoteId"
					)
					and (
						"history_archive_checkpoint_proof".
							"ledgerObjectRemoteId" is null
						or "history_archive_checkpoint_proof".
							"ledgerObjectRemoteId" =
							excluded."ledgerObjectRemoteId"
					)
					and (
						"history_archive_checkpoint_proof".
							"transactionsObjectRemoteId" is null
						or "history_archive_checkpoint_proof".
							"transactionsObjectRemoteId" =
							excluded."transactionsObjectRemoteId"
					)
					and (
						"history_archive_checkpoint_proof".
							"resultsObjectRemoteId" is null
						or "history_archive_checkpoint_proof".
							"resultsObjectRemoteId" =
							excluded."resultsObjectRemoteId"
					)
					and (
						"history_archive_checkpoint_proof".
							"scpObjectRemoteId" is null
						or "history_archive_checkpoint_proof".
							"scpObjectRemoteId" = excluded."scpObjectRemoteId"
					)
					and exists (
						select 1
						from history_archive_checkpoint_proof_refresh_queue queue
						where queue."archiveUrlIdentity" =
							"history_archive_checkpoint_proof"."archiveUrlIdentity"
							and queue."checkpointLedger" =
								"history_archive_checkpoint_proof"."checkpointLedger"
							${scalarQueuedLeaseSql}
							and queue."leaseUntil" > now()
					)
				)
`;

const batchQueuedPendingTransitionSql = queuedPendingTransitionSql.replace(
	scalarQueuedLeaseSql,
	batchQueuedLeaseSql
);

export const historyArchiveCheckpointProofBatchQueuedUpsertSql =
	buildHistoryArchiveCheckpointProofUpsertSql(batchQueuedPendingTransitionSql);
export const historyArchiveCheckpointProofUpsertSql =
	buildHistoryArchiveCheckpointProofUpsertSql('');

export const historyArchiveCheckpointProofQueuedUpsertSql =
	buildHistoryArchiveCheckpointProofUpsertSql(queuedPendingTransitionSql);

export const historyArchiveCheckpointProofDerivedMatchesCurrentSql = `
	row(
		derived."archiveUrl",
		derived.status,
		derived.required_objects_complete,
		derived.proof_facts_complete,
		derived.checkpoint_bucket_list_matches,
		derived.transactions_match,
		derived.results_match,
		derived.previous_ledgers_match,
		derived.buckets_verified,
		derived.ledger_fact_count,
		derived.transaction_fact_count,
		derived.result_fact_count,
		derived.expected_bucket_count,
		derived.verified_bucket_count,
		derived.failed_bucket_count,
		derived.missing_bucket_count,
		derived.checkpoint_bucket_list_hash,
		derived.ledger_bucket_list_hash,
		derived."checkpointStateObjectRemoteId",
		derived."ledgerObjectRemoteId",
		derived."transactionsObjectRemoteId",
		derived."resultsObjectRemoteId",
		derived."scpObjectRemoteId",
		derived.failure_kind,
		jsonb_build_object(
			'expectedLedgerCount', derived.expected_ledger_count,
			'ledgerRawFactCount', derived.ledger_raw_fact_count,
			'ledgerHeaderHashesVerified',
				derived.ledger_header_hashes_verified,
			'transactionRawFactCount', derived.transaction_raw_fact_count,
			'resultRawFactCount', derived.result_raw_fact_count,
			'predecessorMissing', derived.predecessor_missing,
			'predecessorBoundaryValid', derived.predecessor_boundary_valid,
			'predecessorSubstituted', derived.predecessor_substituted,
			'predecessorSourceArchiveUrlIdentity',
				derived.predecessor_source_archive_url_identity,
			'checkpointStateLedgerFactPresent',
				derived.has_checkpoint_ledger_fact,
			'checkpointStateLedgerMatches',
				derived.checkpoint_ledger_matches,
			'scpEntryCount', derived.scp_entry_count,
			'scpExpectationKnown', derived.scp_expectation_known,
			'scpExpected', derived.scp_expected,
			'scpOptional', true,
			'scpPresent', derived.scp_present,
			'scpVerified', derived.scp_verified,
			'hasActiveObject', derived.has_active,
			'hasFailedObject', derived.has_failed,
			'networkPassphrase', derived.network_passphrase,
			'maxProtocolVersion', derived.max_protocol_version,
			'failureErrorType', derived.failure_error_type,
			'failureChannel', derived.failure_channel,
			'failureChannels',
				coalesce(to_jsonb(derived.failure_channels), '[]'::jsonb),
			'failureHttpStatus', derived.failure_http_status,
			'objectFailures',
				coalesce(derived.object_failures, '[]'::jsonb)
		)
	) is not distinct from row(
		proof."archiveUrl",
		proof.status,
		proof."requiredObjectsComplete",
		proof."proofFactsComplete",
		proof."checkpointBucketListMatches",
		proof."transactionsMatch",
		proof."resultsMatch",
		proof."previousLedgersMatch",
		proof."bucketsVerified",
		proof."ledgerFactCount",
		proof."transactionFactCount",
		proof."resultFactCount",
		proof."expectedBucketCount",
		proof."verifiedBucketCount",
		proof."failedBucketCount",
		proof."missingBucketCount",
		proof."checkpointBucketListHash",
		proof."ledgerBucketListHash",
		proof."checkpointStateObjectRemoteId",
		proof."ledgerObjectRemoteId",
		proof."transactionsObjectRemoteId",
		proof."resultsObjectRemoteId",
		proof."scpObjectRemoteId",
		proof."failureKind",
		proof.details
	)
`;
