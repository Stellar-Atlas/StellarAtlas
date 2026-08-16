import type { EntityManager } from 'typeorm';
import { CURRENT_HISTORY_ARCHIVE_CHECKPOINT_PROOF_VERSION } from '../../../domain/history-archive-checkpoint-proof/HistoryArchiveCheckpointProof.js';
import type { HistoryArchiveVerifiedCheckpointObjectSource } from '../../../domain/history-archive-object/HistoryArchiveObjectRepository.js';
import { mapVerifiedCheckpointSourceRows } from './HistoryArchiveVerifiedCheckpointSourceMapper.js';
import type { HistoryArchiveRepairHostResolver } from './HistoryArchiveRepairSourceUrlPolicy.js';

const maxSourceObjects = 500;
const maxSourcesPerObject = 3;
export async function findVerifiedCheckpointObjectSources(
	manager: EntityManager,
	targetRemoteIds: readonly string[],
	limitPerObject: number,
	hostResolver?: HistoryArchiveRepairHostResolver
): Promise<readonly HistoryArchiveVerifiedCheckpointObjectSource[]> {
	const requestedIds = Array.from(new Set(targetRemoteIds)).slice(
		0,
		maxSourceObjects
	);
	if (requestedIds.length === 0) return [];

	const value: unknown = await manager.query(
		historyArchiveVerifiedCheckpointSourceSql,
		[requestedIds, normalizeLimit(limitPerObject)]
	);

	return mapVerifiedCheckpointSourceRows(value, hostResolver);
}

function normalizeLimit(limit: number): number {
	if (!Number.isSafeInteger(limit) || limit < 1) return 1;
	return Math.min(limit, maxSourcesPerObject);
}

export const historyArchiveVerifiedCheckpointSourceSql = `
	with requested_failures as materialized (
		select
			source."remoteId" as "targetRemoteId",
			source."archiveUrlIdentity" as "sourceArchiveUrlIdentity",
			source."checkpointLedger" as "sourceCheckpointLedger",
			source."objectKey" as "sourceObjectKey",
			source."objectType" as "sourceObjectType",
			source_state."networkPassphrase",
			previous_verified."verificationFacts" as "sourceProofFacts"
		from history_archive_object_queue source
		join history_archive_state_snapshot source_state
			on source_state."archiveUrlIdentity" = source."archiveUrlIdentity"
			and source_state.status = 'available'
			and nullif(source_state."networkPassphrase", '') is not null
		left join lateral (
			select event."verificationFacts"
			from history_archive_object_event event
			where event."objectRemoteId" = source."remoteId"
				and event."eventType" = 'verified'
			order by event."createdAt" desc, event."remoteId" desc
			limit 1
		) previous_verified on true
		where source."remoteId" = any($1::uuid[])
			and source."checkpointLedger" is not null
			and source."objectType" in (
				'checkpoint-state',
				'ledger',
				'transactions',
				'results',
				'scp'
			)
	),
	candidate_objects as materialized (
		select
			source.*,
			candidate."archiveUrl",
			candidate."archiveUrlIdentity",
			candidate."hostIdentity",
			candidate."checkpointLedger",
			candidate."objectUrl",
			candidate."remoteId",
			candidate."verificationFacts",
			candidate."verifiedAt",
			candidate."updatedAt"
		from requested_failures source
		cross join lateral (
			select copy.*
			from history_archive_object_queue copy
			where copy."objectType" = source."sourceObjectType"
				and copy."objectKey" = source."sourceObjectKey"
				and copy."archiveUrlIdentity" <>
					source."sourceArchiveUrlIdentity"
				and copy."checkpointLedger" =
					source."sourceCheckpointLedger"
				and copy.status = 'verified'
				and copy."verifiedAt" is not null
				and copy."verificationFacts" #>>
					'{content,algorithm}' = 'sha256'
				and copy."verificationFacts" #>>
					'{content,digest}' ~ '^[0-9a-fA-F]{64}$'
				and (
					(source."sourceObjectType" = 'checkpoint-state'
						and copy."verificationFacts" #>>
							'{content,representation}' = 'canonical-json')
					or (source."sourceObjectType" in (
						'ledger', 'transactions', 'results', 'scp'
					) and copy."verificationFacts" #>>
						'{content,representation}' = 'uncompressed-xdr')
				)
				and char_length(copy."objectUrl") between 1 and 2048
				and copy."objectUrl" ~* '^https?://[^/?#[:space:]@]+'
				and copy."objectUrl" !~ '[[:space:][:cntrl:]]'
		) candidate
		join history_archive_state_snapshot candidate_state
			on candidate_state."archiveUrlIdentity" =
				candidate."archiveUrlIdentity"
			and candidate_state.status = 'available'
			and candidate_state."networkPassphrase" =
				source."networkPassphrase"
	),
	strict_candidates as (
		select
				candidate."targetRemoteId",
				candidate."sourceProofFacts",
				candidate."archiveUrl",
				candidate."archiveUrlIdentity",
				candidate."hostIdentity",
				candidate."remoteId" as "candidateRemoteId",
			candidate."checkpointLedger",
			candidate."objectUrl",
			candidate."verifiedAt",
			lower(candidate."verificationFacts" #>>
				'{content,digest}') as "contentDigest",
			candidate."verificationFacts" #>>
				'{content,representation}' as "contentRepresentation",
				proof."evaluatedAt" as "proofEvaluatedAt",
				proof.id as "proofId",
				proof."proofVersion"
		from candidate_objects candidate
		join history_archive_verified_checkpoint_proof_attestation proof
			on proof."archiveUrlIdentity" =
				candidate."archiveUrlIdentity"
			and proof."checkpointLedger" = candidate."checkpointLedger"
			and proof.status = 'verified'
			and proof."proofVersion" =
				${CURRENT_HISTORY_ARCHIVE_CHECKPOINT_PROOF_VERSION}
			and proof."requiredObjectsComplete" = true
			and proof."proofFactsComplete" = true
			and proof."checkpointBucketListMatches" = true
			and proof."transactionsMatch" = true
			and proof."resultsMatch" = true
			and proof."previousLedgersMatch" = true
			and proof."bucketsVerified" = true
			and proof."failedBucketCount" = 0
			and proof."missingBucketCount" = 0
			and proof."verifiedBucketCount" = proof."expectedBucketCount"
			and case candidate."sourceObjectType"
				when 'checkpoint-state' then
					proof."checkpointStateObjectRemoteId" = candidate."remoteId"
				when 'ledger' then
					proof."ledgerObjectRemoteId" = candidate."remoteId"
				when 'transactions' then
					proof."transactionsObjectRemoteId" = candidate."remoteId"
				when 'results' then
					proof."resultsObjectRemoteId" = candidate."remoteId"
				when 'scp' then
					proof."scpObjectRemoteId" = candidate."remoteId"
				else false
			end
		join history_archive_checkpoint_proof current_proof
			on current_proof.id = proof.id
			and current_proof."archiveUrlIdentity" =
				proof."archiveUrlIdentity"
			and current_proof."checkpointLedger" = proof."checkpointLedger"
			and current_proof.status = 'verified'
			and current_proof."proofVersion" = proof."proofVersion"
			and current_proof."evaluatedAt" = proof."evaluatedAt"
			and current_proof."updatedAt" = proof."updatedAt"
			and current_proof."checkpointStateObjectRemoteId" =
				proof."checkpointStateObjectRemoteId"
			and current_proof."ledgerObjectRemoteId" =
				proof."ledgerObjectRemoteId"
			and current_proof."transactionsObjectRemoteId" =
				proof."transactionsObjectRemoteId"
			and current_proof."resultsObjectRemoteId" =
				proof."resultsObjectRemoteId"
			and current_proof."scpObjectRemoteId" is not distinct from
				proof."scpObjectRemoteId"
		join history_archive_object_queue proof_checkpoint
			on proof_checkpoint."remoteId" =
				proof."checkpointStateObjectRemoteId"
			and proof_checkpoint."archiveUrlIdentity" =
				proof."archiveUrlIdentity"
			and proof_checkpoint."checkpointLedger" = proof."checkpointLedger"
			and proof_checkpoint."objectType" = 'checkpoint-state'
			and proof_checkpoint.status = 'verified'
			and (
				proof_checkpoint."transitionEffectsRequiredAt" is null
				or proof_checkpoint."transitionEffectsCompletedAt" is not null
			)
		cross join lateral (
			select greatest(
				proof."evaluatedAt",
				coalesce(
					proof_checkpoint."proofReconciledAt",
					'-infinity'::timestamptz
				)
			) as "effectiveEvaluatedAt"
		) proof_freshness
		where proof_freshness."effectiveEvaluatedAt" >= candidate."verifiedAt"
			and candidate."updatedAt" <=
				proof_freshness."effectiveEvaluatedAt"
			and proof."expectedBucketCount" = (
				select count(*)
				from history_archive_checkpoint_bucket_dependency expected_dependency
				where expected_dependency."archiveUrlIdentity" =
					proof."archiveUrlIdentity"
					and expected_dependency."checkpointLedger" =
						proof."checkpointLedger"
					and expected_dependency."createdAt" <=
						proof_freshness."effectiveEvaluatedAt"
			)
			and (
				select count(*)
				from history_archive_object_queue proof_input
				where proof_input."remoteId" in (
					proof."checkpointStateObjectRemoteId",
					proof."ledgerObjectRemoteId",
					proof."transactionsObjectRemoteId",
					proof."resultsObjectRemoteId",
					proof."scpObjectRemoteId"
				)
					and proof_input.status = 'verified'
					and proof_input."verifiedAt" is not null
					and proof_input."verifiedAt" <=
						proof_freshness."effectiveEvaluatedAt"
					and proof_input."updatedAt" <=
						proof_freshness."effectiveEvaluatedAt"
			) = 4 + case
				when proof."scpObjectRemoteId" is null then 0 else 1
			end
			and not exists (
				select 1
				from history_archive_object_queue proof_scope_input
				where proof_scope_input."archiveUrlIdentity" =
					proof."archiveUrlIdentity"
					and proof_scope_input."checkpointLedger" =
						proof."checkpointLedger"
					and proof_scope_input."objectType" in (
						'checkpoint-state',
						'ledger',
						'transactions',
						'results',
						'scp'
					)
					and greatest(
						proof_scope_input."updatedAt",
						coalesce(
							proof_scope_input."verifiedAt",
							'-infinity'::timestamptz
						)
					) > proof_freshness."effectiveEvaluatedAt"
			)
			and not exists (
				select 1
				from history_archive_checkpoint_bucket_dependency dependency
			left join history_archive_object_queue bucket
				on bucket."archiveUrlIdentity" =
					dependency."archiveUrlIdentity"
				and bucket."objectType" = 'bucket'
				and bucket."objectKey" = 'bucket:' || dependency."bucketHash"
				where dependency."archiveUrlIdentity" =
					proof."archiveUrlIdentity"
					and dependency."checkpointLedger" = proof."checkpointLedger"
					and (
						dependency."createdAt" >
							proof_freshness."effectiveEvaluatedAt"
						or bucket."remoteId" is null
						or bucket.status <> 'verified'
						or bucket."verifiedAt" is null
						or bucket."verifiedAt" >
							proof_freshness."effectiveEvaluatedAt"
						or bucket."updatedAt" >
							proof_freshness."effectiveEvaluatedAt"
					)
			)
			and (
				proof."checkpointLedger" = 63
				or exists (
					select 1
					from history_archive_object_queue predecessor
					where predecessor."archiveUrlIdentity" =
						proof."archiveUrlIdentity"
						and predecessor."checkpointLedger" =
							proof."checkpointLedger" - 64
						and predecessor."objectType" = 'ledger'
						and predecessor.status = 'verified'
						and predecessor."verifiedAt" is not null
						and predecessor."verifiedAt" <=
							proof_freshness."effectiveEvaluatedAt"
						and predecessor."updatedAt" <=
							proof_freshness."effectiveEvaluatedAt"
				)
			)
	), digest_consensus as (
		select
			candidate."targetRemoteId",
			candidate."contentDigest",
			candidate."contentRepresentation",
				count(distinct candidate."hostIdentity")::integer
					as source_count
		from strict_candidates candidate
		group by candidate."targetRemoteId", candidate."contentDigest",
			candidate."contentRepresentation"
		), qualifying_consensus as (
			select consensus."targetRemoteId",
				count(*) filter (where consensus.source_count >= 2)::integer
					as qualifying_group_count
			from digest_consensus consensus
			group by consensus."targetRemoteId"
		), anchored_candidates as (
		select candidate.*,
			case when lower(candidate."sourceProofFacts" #>>
				'{content,digest}') = candidate."contentDigest"
				and candidate."sourceProofFacts" #>>
					'{content,representation}' = candidate."contentRepresentation"
			then 'target-digest' else 'multi-source' end as "anchorKind",
			consensus.source_count as "corroboratingSourceCount"
		from strict_candidates candidate
			join digest_consensus consensus
			on consensus."targetRemoteId" = candidate."targetRemoteId"
			and consensus."contentDigest" = candidate."contentDigest"
				and consensus."contentRepresentation" =
					candidate."contentRepresentation"
			join qualifying_consensus qualifying
				on qualifying."targetRemoteId" = candidate."targetRemoteId"
		where (
			candidate."sourceProofFacts" #>> '{content,algorithm}' = 'sha256'
			and candidate."sourceProofFacts" #>>
				'{content,digest}' ~ '^[0-9a-fA-F]{64}$'
			and lower(candidate."sourceProofFacts" #>>
				'{content,digest}') = candidate."contentDigest"
			and candidate."sourceProofFacts" #>>
				'{content,representation}' = candidate."contentRepresentation"
			) or (
				consensus.source_count >= 2
				and qualifying.qualifying_group_count = 1
			)
	),
	ranked_candidates as (
		select
			candidate.*,
			row_number() over (
				partition by candidate."targetRemoteId"
				order by candidate."proofEvaluatedAt" desc,
					candidate."verifiedAt" desc,
					candidate."archiveUrlIdentity" asc
			) as candidate_rank
		from anchored_candidates candidate
	)
	select
		"targetRemoteId",
		"anchorKind",
		"archiveUrl",
		"archiveUrlIdentity",
		"candidateRemoteId",
		"checkpointLedger",
		"contentDigest",
		"contentRepresentation",
		"corroboratingSourceCount",
		"objectUrl",
		"proofEvaluatedAt",
		"proofId",
		"proofVersion",
		"verifiedAt"
	from ranked_candidates
	where candidate_rank <= $2::integer
	order by "targetRemoteId" asc, candidate_rank asc
`;
