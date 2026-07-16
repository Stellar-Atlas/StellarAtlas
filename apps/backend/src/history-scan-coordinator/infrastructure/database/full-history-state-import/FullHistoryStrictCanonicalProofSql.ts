export const FULL_HISTORY_STATE_COVERAGE_MINIMUM_PROOF_VERSION = 6;

// Version 6 added the checkpoint-state ledger binding. Version 7 only made
// SCP evidence optional, so an already-verified version 6 proof remains valid.
export const fullHistoryStrictCanonicalBatchProofPredicateSql = `
	current_proof.id = batch."checkpoint_proof_id"
	and current_proof."archiveUrlIdentity" = batch."archive_url_identity"
	and current_proof."checkpointLedger" = batch."checkpoint_ledger"
	and current_proof.status = 'verified'
	and current_proof."proofVersion" >=
		${FULL_HISTORY_STATE_COVERAGE_MINIMUM_PROOF_VERSION}
	and current_proof."failureKind" is null
	and current_proof."requiredObjectsComplete"
	and current_proof."proofFactsComplete"
	and current_proof."checkpointBucketListMatches"
	and current_proof."transactionsMatch"
	and current_proof."resultsMatch"
	and current_proof."previousLedgersMatch"
	and current_proof."bucketsVerified"
	and current_proof."ledgerFactCount" = case
		when batch."checkpoint_ledger" = 63 then 63 else 64 end
	and current_proof."transactionFactCount" = case
		when batch."checkpoint_ledger" = 63 then 63 else 64 end
	and current_proof."resultFactCount" = case
		when batch."checkpoint_ledger" = 63 then 63 else 64 end
	and current_proof.details ->> 'checkpointStateLedgerFactPresent' = 'true'
	and current_proof.details ->> 'checkpointStateLedgerMatches' = 'true'
	and sha256(convert_to(
		current_proof.details ->> 'networkPassphrase', 'UTF8'
	)) = batch."network_passphrase_hash"
	and current_proof."checkpointStateObjectRemoteId" =
		batch."checkpoint_state_object_remote_id"
	and current_proof."ledgerObjectRemoteId" =
		batch."ledger_object_remote_id"
	and current_proof."transactionsObjectRemoteId" =
		batch."transactions_object_remote_id"
	and current_proof."resultsObjectRemoteId" =
		batch."results_object_remote_id"
	and not exists (
		select 1
		from (values
			(
				batch."checkpoint_state_object_remote_id",
				batch."checkpoint_state_content_digest",
				'checkpoint-state'::text,
				'canonical-json'::text
			),
			(
				batch."ledger_object_remote_id",
				batch."ledger_content_digest",
				'ledger'::text,
				'uncompressed-xdr'::text
			),
			(
				batch."transactions_object_remote_id",
				batch."transactions_content_digest",
				'transactions'::text,
				'uncompressed-xdr'::text
			),
			(
				batch."results_object_remote_id",
				batch."results_content_digest",
				'results'::text,
				'uncompressed-xdr'::text
			)
		) expected("remoteId", digest, "objectType", representation)
		left join "history_archive_object_queue" source
			on source."remoteId" = expected."remoteId"
			and source."archiveUrlIdentity" = batch."archive_url_identity"
			and source."checkpointLedger" = batch."checkpoint_ledger"
			and source."objectType" = expected."objectType"
		where source."remoteId" is null
			or source.status is distinct from 'verified'
			or source."verificationFacts"->'content'->>'algorithm'
				is distinct from 'sha256'
			or source."verificationFacts"->'content'->>'representation'
				is distinct from expected.representation
			or lower(source."verificationFacts"->'content'->>'digest')
				is distinct from encode(expected.digest, 'hex')
	)
`;
