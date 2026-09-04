import type { EntityManager } from 'typeorm';
import { CURRENT_HISTORY_ARCHIVE_CHECKPOINT_PROOF_VERSION } from '../../../domain/history-archive-checkpoint-proof/HistoryArchiveCheckpointProof.js';
import type { HistoryArchiveVerifiedBucketSource } from '../../../domain/history-archive-object/HistoryArchiveObjectRepository.js';
import {
	createHistoryArchiveRepairSourceUrlPolicy,
	type HistoryArchiveRepairHostResolver,
	type HistoryArchiveRepairSourceUrlPolicy
} from './HistoryArchiveRepairSourceUrlPolicy.js';
import { mapRepairSourcesWithBoundedConcurrency } from './BoundedRepairSourceMapper.js';
import { historyArchiveCheckpointBucketDependenciesSql } from './HistoryArchiveCheckpointDependencyReadSql.js';

const maximumTargets = 500;
const maximumSourcesPerTarget = 3;
const sha256Pattern = /^[0-9a-f]{64}$/;
const uuidPattern =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type VerifiedBucketSourceRow = {
	readonly archiveUrl?: string;
	readonly archiveurl?: string;
	readonly archiveUrlIdentity?: string;
	readonly archiveurlidentity?: string;
	readonly bucketHash?: string;
	readonly buckethash?: string;
	readonly candidateRemoteId?: string;
	readonly candidateremoteid?: string;
	readonly checkpointLedger?: number | string;
	readonly checkpointledger?: number | string;
	readonly objectUrl?: string;
	readonly objecturl?: string;
	readonly proofEvaluatedAt?: Date | string;
	readonly proofevaluatedat?: Date | string;
	readonly proofId?: number | string;
	readonly proofid?: number | string;
	readonly proofVersion?: number | string;
	readonly proofversion?: number | string;
	readonly targetRemoteId?: string;
	readonly targetremoteid?: string;
	readonly verifiedAt?: Date | string;
	readonly verifiedat?: Date | string;
};

export async function findVerifiedBucketSources(
	manager: EntityManager,
	targetRemoteIds: readonly string[],
	limitPerObject: number,
	hostResolver?: HistoryArchiveRepairHostResolver
): Promise<readonly HistoryArchiveVerifiedBucketSource[]> {
	const requestedIds = Array.from(new Set(targetRemoteIds)).slice(
		0,
		maximumTargets
	);
	if (requestedIds.length === 0) return [];
	const value: unknown = await manager.query(
		historyArchiveVerifiedBucketSourceSql,
		[requestedIds, normalizeLimit(limitPerObject)]
	);
	const policy = createHistoryArchiveRepairSourceUrlPolicy(hostResolver);
	const candidates = await mapRepairSourcesWithBoundedConcurrency(
		requireRows(value),
		(row) => mapRow(row, policy).catch(() => null)
	);
	return candidates.filter(isPresent);
}

function normalizeLimit(value: number): number {
	if (!Number.isSafeInteger(value) || value < 1) return 1;
	return Math.min(value, maximumSourcesPerTarget);
}

function requireRows(value: unknown): readonly VerifiedBucketSourceRow[] {
	if (!Array.isArray(value)) {
		throw new Error('Verified bucket source query did not return rows');
	}
	return value.map((row) => {
		if (typeof row !== 'object' || row === null || Array.isArray(row)) {
			throw new Error('Verified bucket source query returned an invalid row');
		}
		return row;
	});
}

async function mapRow(
	row: VerifiedBucketSourceRow,
	urlPolicy: HistoryArchiveRepairSourceUrlPolicy
): Promise<HistoryArchiveVerifiedBucketSource> {
	const archiveUrl = requireString(
		row.archiveUrl ?? row.archiveurl,
		'archiveUrl'
	);
	const archiveUrlIdentity = requireString(
		row.archiveUrlIdentity ?? row.archiveurlidentity,
		'archiveUrlIdentity'
	);
	const bucketHash = requireDigest(
		row.bucketHash ?? row.buckethash,
		'bucketHash'
	);
	return {
		anchorKind: 'content-addressed-bucket',
		archiveUrl,
		archiveUrlIdentity,
		bucketHash,
		candidateRemoteId: requireUuid(
			row.candidateRemoteId ?? row.candidateremoteid,
			'candidateRemoteId'
		),
		checkpointLedger: requireInteger(
			row.checkpointLedger ?? row.checkpointledger,
			'checkpointLedger',
			0
		),
		contentDigest: bucketHash,
		contentRepresentation: 'uncompressed-xdr',
		corroboratingSourceCount: 1,
		objectUrl: await urlPolicy.requireObjectUrl(
			row.objectUrl ?? row.objecturl,
			archiveUrl,
			archiveUrlIdentity
		),
		proofEvaluatedAt: requireDate(
			row.proofEvaluatedAt ?? row.proofevaluatedat,
			'proofEvaluatedAt'
		),
		proofId: requireInteger(row.proofId ?? row.proofid, 'proofId', 1),
		proofVersion: requireInteger(
			row.proofVersion ?? row.proofversion,
			'proofVersion',
			1
		),
		targetRemoteId: requireUuid(
			row.targetRemoteId ?? row.targetremoteid,
			'targetRemoteId'
		),
		verifiedAt: requireDate(row.verifiedAt ?? row.verifiedat, 'verifiedAt')
	};
}

function isPresent<T>(value: T | null): value is T {
	return value !== null;
}

function requireString(value: string | undefined, field: string): string {
	if (typeof value === 'string' && value.length > 0) return value;
	throw new Error(`Verified bucket source row is missing ${field}`);
}

function requireUuid(value: string | undefined, field: string): string {
	const uuid = requireString(value, field);
	if (uuidPattern.test(uuid)) return uuid;
	throw new Error(`Verified bucket source row has invalid ${field}`);
}

function requireDigest(value: string | undefined, field: string): string {
	const digest = requireString(value, field).toLowerCase();
	if (sha256Pattern.test(digest)) return digest;
	throw new Error(`Verified bucket source row has invalid ${field}`);
}

function requireInteger(
	value: number | string | undefined,
	field: string,
	minimum: number
): number {
	const number = typeof value === 'number' ? value : Number(value);
	if (Number.isSafeInteger(number) && number >= minimum) return number;
	throw new Error(`Verified bucket source row has invalid ${field}`);
}

function requireDate(value: Date | string | undefined, field: string): Date {
	const date = value instanceof Date ? value : new Date(value ?? '');
	if (!Number.isNaN(date.getTime())) return date;
	throw new Error(`Verified bucket source row has invalid ${field}`);
}

const strictProofPredicateSql = `
	proof.status = 'verified'
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
`;

export const historyArchiveVerifiedBucketSourceSql = `
	with requested_failures as materialized (
		select
			target."remoteId" as "targetRemoteId",
			target."archiveUrlIdentity" as "targetArchiveUrlIdentity",
			lower(target."bucketHash") as "bucketHash",
			target_state."networkPassphrase"
		from history_archive_object_queue target
		join history_archive_state_snapshot target_state
			on target_state."archiveUrlIdentity" = target."archiveUrlIdentity"
			and target_state.status = 'available'
			and nullif(target_state."networkPassphrase", '') is not null
		where target."remoteId" = any($1::uuid[])
			and target."objectType" = 'bucket'
			and target."bucketHash" ~ '^[0-9a-fA-F]{64}$'
	), requested_bucket_hashes as materialized (
		select distinct target."bucketHash"
		from requested_failures target
	), shared_bucket_dependencies as materialized (
		select observation."archiveUrlIdentity",
			observation."checkpointLedger", member."bucketHash",
			coalesce(
				checkpoint."dependenciesMaterializedAt",
				checkpoint."verifiedAt",
				observation."createdAt"
			) as "createdAt"
		from requested_bucket_hashes target
		join history_archive_checkpoint_bucket_set_member member
			on member."bucketHash" = target."bucketHash"
		join history_archive_checkpoint_content content
			on content."bucketSetDigest" = member."bucketSetDigest"
		join history_archive_checkpoint_content_observation observation
			on observation."contentDigest" = content."contentDigest"
		left join history_archive_object_queue checkpoint
			on checkpoint."remoteId" = observation."checkpointStateObjectRemoteId"
	), candidate_proofs as materialized (
		select
			target."targetRemoteId",
			target."bucketHash",
			candidate."archiveUrl",
			candidate."archiveUrlIdentity",
			candidate."objectUrl",
			candidate."remoteId" as "candidateRemoteId",
			candidate."verifiedAt",
			proof."checkpointLedger",
			proof."evaluatedAt" as "proofEvaluatedAt",
			proof.id as "proofId",
			proof."proofVersion"
		from requested_failures target
		join history_archive_object_queue candidate
			on candidate."objectType" = 'bucket'
			and candidate."objectKey" = 'bucket:' || target."bucketHash"
			and candidate."archiveUrlIdentity" <>
				target."targetArchiveUrlIdentity"
			and candidate.status = 'verified'
			and candidate."verifiedAt" is not null
			and candidate."verificationFacts" #>>
				'{bucketObject,expectedBucketHash}' = target."bucketHash"
			and candidate."verificationFacts" #>>
				'{bucketObject,matched}' = 'true'
			and candidate."verificationFacts" #>>
				'{bucketObject,sourceUrl}' = candidate."objectUrl"
			and candidate."verificationFacts" #>>
				'{content,algorithm}' = 'sha256'
			and lower(candidate."verificationFacts" #>>
				'{content,digest}') = target."bucketHash"
			and candidate."verificationFacts" #>>
				'{content,representation}' = 'uncompressed-xdr'
		join history_archive_state_snapshot candidate_state
			on candidate_state."archiveUrlIdentity" =
				candidate."archiveUrlIdentity"
			and candidate_state.status = 'available'
			and candidate_state."networkPassphrase" = target."networkPassphrase"
		join shared_bucket_dependencies dependency
			on dependency."archiveUrlIdentity" = candidate."archiveUrlIdentity"
			and dependency."bucketHash" = target."bucketHash"
		join history_archive_checkpoint_proof proof
			on proof."archiveUrlIdentity" = dependency."archiveUrlIdentity"
			and proof."checkpointLedger" = dependency."checkpointLedger"
			and ${strictProofPredicateSql}
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
			and dependency."createdAt" <=
				proof_freshness."effectiveEvaluatedAt"
			and proof."expectedBucketCount" = (
				select count(*)
				from lateral (
					${historyArchiveCheckpointBucketDependenciesSql(
						'proof."archiveUrlIdentity"',
						'proof."checkpointLedger"'
					)}
				) expected_dependency
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
				from lateral (
				${historyArchiveCheckpointBucketDependenciesSql(
					'proof."archiveUrlIdentity"',
					'proof."checkpointLedger"'
				)}
			) proof_dependency
				left join history_archive_object_queue proof_bucket
					on proof_bucket."archiveUrlIdentity" =
						proof_dependency."archiveUrlIdentity"
					and proof_bucket."objectType" = 'bucket'
					and proof_bucket."objectKey" =
						'bucket:' || proof_dependency."bucketHash"
				where proof_dependency."archiveUrlIdentity" =
					proof."archiveUrlIdentity"
					and proof_dependency."checkpointLedger" =
						proof."checkpointLedger"
					and (
						proof_dependency."createdAt" >
							proof_freshness."effectiveEvaluatedAt"
						or proof_bucket."remoteId" is null
						or proof_bucket.status <> 'verified'
						or proof_bucket."verifiedAt" is null
						or proof_bucket."verifiedAt" >
							proof_freshness."effectiveEvaluatedAt"
						or proof_bucket."updatedAt" >
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
			and char_length(candidate."objectUrl") between 1 and 2048
			and candidate."objectUrl" ~* '^https?://[^/?#[:space:]@]+'
			and candidate."objectUrl" !~ '[[:space:][:cntrl:]]'
	), latest_per_source as (
		select distinct on (
			"targetRemoteId",
			"archiveUrlIdentity"
		) *
		from candidate_proofs
		order by "targetRemoteId", "archiveUrlIdentity",
			"proofEvaluatedAt" desc, "checkpointLedger" desc
	), ranked_sources as (
		select source.*,
			row_number() over (
				partition by source."targetRemoteId"
				order by source."proofEvaluatedAt" desc,
					source."verifiedAt" desc,
					source."archiveUrlIdentity" asc
			) as source_rank
		from latest_per_source source
	)
	select
		"targetRemoteId",
		"bucketHash",
		"archiveUrl",
		"archiveUrlIdentity",
		"objectUrl",
		"candidateRemoteId",
		"verifiedAt",
		"checkpointLedger",
		"proofEvaluatedAt",
		"proofId",
		"proofVersion"
	from ranked_sources
	where source_rank <= $2::integer
	order by "targetRemoteId" asc, source_rank asc
`;
