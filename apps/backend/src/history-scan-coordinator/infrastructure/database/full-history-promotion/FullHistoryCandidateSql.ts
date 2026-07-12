export const fullHistoryProofSql = `
	select
		proof.id,
		proof."archiveUrlIdentity",
		proof."checkpointLedger",
		proof.status,
		proof."proofVersion",
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
		proof."failureKind",
		proof.details,
		proof."evaluatedAt",
		proof."checkpointStateObjectRemoteId",
		proof."ledgerObjectRemoteId",
		proof."transactionsObjectRemoteId",
		proof."resultsObjectRemoteId"
	from "history_archive_checkpoint_proof" proof
	where proof."archiveUrlIdentity" = $1 and proof."checkpointLedger" = $2
	limit 2
`;

export const fullHistorySourceObjectsSql = `
	select
		source."remoteId",
		source."archiveUrlIdentity",
		source."objectType",
		source.status,
		source."checkpointLedger",
		source."verificationFacts"
	from "history_archive_object_queue" source
	where source."remoteId" = any($1::uuid[])
	order by source."remoteId"
`;

export const fullHistoryObservedLedgersSql = `
	select
		header."ledgerSequence",
		header."ledgerHeaderHash",
		header."previousLedgerHeaderHash",
		header."transactionSetHash",
		header."transactionResultHash",
		header."bucketListHash",
		header."protocolVersion",
		observation."closedAt"
	from "parsed_ledger_header_observation" observation
	join "parsed_ledger_header" header
		on header.id = observation."parsedLedgerHeaderId"
	where observation."sourceObjectRemoteId" = $1
	order by header."ledgerSequence", header."ledgerHeaderHash"
	limit 66
`;

export const fullHistoryObservedEnvelopesSql = `
	select
		envelope."ledgerSequence",
		envelope."transactionIndex",
		envelope."transactionSetHash",
		envelope."envelopeXdr"
	from "parsed_transaction_envelope_observation" observation
	join "parsed_transaction_envelope" envelope
		on envelope.id = observation."parsedTransactionEnvelopeId"
	where observation."sourceObjectRemoteId" = $1
	order by envelope."ledgerSequence", envelope."transactionIndex"
limit $2
`;

export const fullHistoryObservedResultsSql = `
	select
		result."ledgerSequence",
		result."transactionIndex",
		result."transactionResultHash",
		result."transactionHash",
		result."resultXdr"
	from "parsed_transaction_result_observation" observation
	join "parsed_transaction_result" result
		on result.id = observation."parsedTransactionResultId"
	where observation."sourceObjectRemoteId" = $1
	order by result."ledgerSequence", result."transactionIndex"
limit $2
`;

export const fullHistoryObservedTransactionBoundsSql = `
	select
		(select count(*)::bigint
		from "parsed_transaction_envelope_observation" observation
		where observation."sourceObjectRemoteId" = $1) as "envelopeCount",
		(select coalesce(sum(octet_length(envelope."envelopeXdr")), 0)::bigint
		from "parsed_transaction_envelope_observation" observation
		join "parsed_transaction_envelope" envelope
			on envelope.id = observation."parsedTransactionEnvelopeId"
		where observation."sourceObjectRemoteId" = $1) as "envelopeBytes",
		(select count(*)::bigint
		from "parsed_transaction_result_observation" observation
		where observation."sourceObjectRemoteId" = $2) as "resultCount",
		(select coalesce(sum(octet_length(result."resultXdr")), 0)::bigint
		from "parsed_transaction_result_observation" observation
		join "parsed_transaction_result" result
			on result.id = observation."parsedTransactionResultId"
		where observation."sourceObjectRemoteId" = $2) as "resultBytes"
`;
