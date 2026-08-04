import { CURRENT_HISTORY_ARCHIVE_CHECKPOINT_PROOF_VERSION } from '../../../domain/history-archive-checkpoint-proof/HistoryArchiveCheckpointProof.js';

export const historyArchiveCheckpointProofUpsertSql = `
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
					"history_archive_checkpoint_proof".status <> 'verified'
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
				or (
					"history_archive_checkpoint_proof".status = 'verified'
					and excluded.status = 'verified'
				)
			)
		)
`;
