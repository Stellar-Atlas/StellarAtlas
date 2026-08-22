import { CURRENT_HISTORY_ARCHIVE_CHECKPOINT_PROOF_VERSION } from '../../../domain/history-archive-checkpoint-proof/HistoryArchiveCheckpointProof.js';
import { historyArchiveCheckpointProofDerivedMatchesCurrentSql } from './HistoryArchiveCheckpointProofUpsertSql.js';

export const historyArchiveCheckpointProofPendingSourceEnrichmentSql = `
	with source_ids as (
		select
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
				where object."objectType" = 'scp'))::uuid
				as "scpObjectRemoteId"
		from "history_archive_object_queue" object
		where object."archiveUrlIdentity" = $1::text
			and object."checkpointLedger" = $2::integer
	)
	update "history_archive_checkpoint_proof" proof
	set
		"checkpointStateObjectRemoteId" = coalesce(
			proof."checkpointStateObjectRemoteId",
			source."checkpointStateObjectRemoteId"
		),
		"ledgerObjectRemoteId" = coalesce(
			proof."ledgerObjectRemoteId", source."ledgerObjectRemoteId"
		),
		"transactionsObjectRemoteId" = coalesce(
			proof."transactionsObjectRemoteId",
			source."transactionsObjectRemoteId"
		),
		"resultsObjectRemoteId" = coalesce(
			proof."resultsObjectRemoteId", source."resultsObjectRemoteId"
		),
		"scpObjectRemoteId" = coalesce(
			proof."scpObjectRemoteId", source."scpObjectRemoteId"
		),
		"updatedAt" = now()
	from source_ids source
	where proof."archiveUrlIdentity" = $1::text
		and proof."checkpointLedger" = $2::integer
		and proof.status = 'pending'
		and proof."proofVersion" =
			${CURRENT_HISTORY_ARCHIVE_CHECKPOINT_PROOF_VERSION}
		and (
			(proof."checkpointStateObjectRemoteId" is null
				and source."checkpointStateObjectRemoteId" is not null)
			or (proof."ledgerObjectRemoteId" is null
				and source."ledgerObjectRemoteId" is not null)
			or (proof."transactionsObjectRemoteId" is null
				and source."transactionsObjectRemoteId" is not null)
			or (proof."resultsObjectRemoteId" is null
				and source."resultsObjectRemoteId" is not null)
			or (proof."scpObjectRemoteId" is null
				and source."scpObjectRemoteId" is not null)
		)
`;

export const historyArchiveCheckpointProofPendingSourceBatchEnrichmentSql = `
	with input_targets as materialized (
		select target."archiveUrlIdentity", target."checkpointLedger"
		from jsonb_to_recordset($1::jsonb) as target(
			"archiveUrlIdentity" text,
			"checkpointLedger" integer
		)
	), source_ids as materialized (
		select
			target."archiveUrlIdentity",
			target."checkpointLedger",
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
				where object."objectType" = 'scp'))::uuid
				as "scpObjectRemoteId"
		from input_targets target
		join "history_archive_object_queue" object
			on object."archiveUrlIdentity" = target."archiveUrlIdentity"
			and object."checkpointLedger" = target."checkpointLedger"
		group by target."archiveUrlIdentity", target."checkpointLedger"
	)
	update "history_archive_checkpoint_proof" proof
	set
		"checkpointStateObjectRemoteId" = coalesce(
			proof."checkpointStateObjectRemoteId",
			source."checkpointStateObjectRemoteId"
		),
		"ledgerObjectRemoteId" = coalesce(
			proof."ledgerObjectRemoteId", source."ledgerObjectRemoteId"
		),
		"transactionsObjectRemoteId" = coalesce(
			proof."transactionsObjectRemoteId",
			source."transactionsObjectRemoteId"
		),
		"resultsObjectRemoteId" = coalesce(
			proof."resultsObjectRemoteId", source."resultsObjectRemoteId"
		),
		"scpObjectRemoteId" = coalesce(
			proof."scpObjectRemoteId", source."scpObjectRemoteId"
		),
		"updatedAt" = now()
	from source_ids source
	where proof."archiveUrlIdentity" = source."archiveUrlIdentity"
		and proof."checkpointLedger" = source."checkpointLedger"
		and proof.status = 'pending'
		and proof."proofVersion" =
			${CURRENT_HISTORY_ARCHIVE_CHECKPOINT_PROOF_VERSION}
		and (
			(proof."checkpointStateObjectRemoteId" is null
				and source."checkpointStateObjectRemoteId" is not null)
			or (proof."ledgerObjectRemoteId" is null
				and source."ledgerObjectRemoteId" is not null)
			or (proof."transactionsObjectRemoteId" is null
				and source."transactionsObjectRemoteId" is not null)
			or (proof."resultsObjectRemoteId" is null
				and source."resultsObjectRemoteId" is not null)
			or (proof."scpObjectRemoteId" is null
				and source."scpObjectRemoteId" is not null)
		)
`;

export const historyArchiveCheckpointProofPreservedAttestationSql = `
	(
		(
			proof.status in ('verified', 'mismatch')
			and derived.status in ('pending', 'not-evaluable')
		)
		or (
			proof.status = 'not-evaluable'
			and derived.status = 'pending'
		)
	)
`;

export const historyArchiveCheckpointProofReconciliationAcknowledgementCteSql = `
	, reconciliation_acknowledgement as (
		update "history_archive_object_queue" checkpoint
		set "proofReconciledAt" = greatest(
			coalesce(
				checkpoint."proofReconciledAt",
				'-infinity'::timestamptz
			),
			now()
		)
		from finalized derived
		join "history_archive_checkpoint_proof" proof
			on proof."archiveUrlIdentity" = derived."archiveUrlIdentity"
			and proof."checkpointLedger" = derived."checkpointLedger"
		left join upserted
			on upserted."archiveUrlIdentity" = derived."archiveUrlIdentity"
			and upserted."checkpointLedger" = derived."checkpointLedger"
		where checkpoint."remoteId" =
				derived."checkpointStateObjectRemoteId"
		and checkpoint."objectType" = 'checkpoint-state'
		and checkpoint.status = 'verified'
		and (
			checkpoint."transitionEffectsRequiredAt" is null
			or checkpoint."transitionEffectsCompletedAt" is not null
		)
		and checkpoint."archiveUrlIdentity" = derived."archiveUrlIdentity"
		and checkpoint."checkpointLedger" = derived."checkpointLedger"
		and derived.status in (
			'verified', 'mismatch', 'not-evaluable', 'pending'
		)
		and upserted."archiveUrlIdentity" is null
		and proof."checkpointStateObjectRemoteId" = checkpoint."remoteId"
		and (
			proof.status = derived.status
			or ${historyArchiveCheckpointProofPreservedAttestationSql}
		)
		and proof."proofVersion" =
			${CURRENT_HISTORY_ARCHIVE_CHECKPOINT_PROOF_VERSION}
		and proof."evaluatedAt" <= now()
		and (
			${historyArchiveCheckpointProofDerivedMatchesCurrentSql}
			or ${historyArchiveCheckpointProofPreservedAttestationSql}
		)
		returning checkpoint."remoteId"
	)
`;
