export const fullHistoryStrictProofSourceDigestsSql = `
	not exists (
		select 1
		from (values
			(
				proof."checkpointStateObjectRemoteId",
				'checkpoint-state'::text,
				'canonical-json'::text
			),
			(proof."ledgerObjectRemoteId", 'ledger', 'uncompressed-xdr'),
			(
				proof."transactionsObjectRemoteId",
				'transactions',
				'uncompressed-xdr'
			),
			(proof."resultsObjectRemoteId", 'results', 'uncompressed-xdr')
		) required("remoteId", "objectType", representation)
		left join "history_archive_object_queue" source
			on source."remoteId" = required."remoteId"
			and source."objectType" = required."objectType"
			and source."archiveUrlIdentity" = proof."archiveUrlIdentity"
			and source."checkpointLedger" = proof."checkpointLedger"
			and source.status = 'verified'
		where source."remoteId" is null
			or source."verificationFacts"->'content'->>'algorithm' <> 'sha256'
			or source."verificationFacts"->'content'->>'representation' <>
				required.representation
			or lower(coalesce(
				source."verificationFacts"->'content'->>'digest', ''
			)) !~ '^[0-9a-f]{64}$'
	)
`;
