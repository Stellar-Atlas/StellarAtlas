import type { EntityManager } from 'typeorm';
import { CURRENT_HISTORY_ARCHIVE_CHECKPOINT_PROOF_VERSION } from '../../../domain/history-archive-checkpoint-proof/HistoryArchiveCheckpointProof.js';
import type { HistoryArchiveVerifiedCheckpointObjectSource } from '../../../domain/history-archive-object/HistoryArchiveObjectRepository.js';
import {
	createHistoryArchiveRepairSourceUrlPolicy,
	type HistoryArchiveRepairHostResolver,
	type HistoryArchiveRepairSourceUrlPolicy
} from './HistoryArchiveRepairSourceUrlPolicy.js';

const maxSourceObjects = 500;
const maxSourcesPerObject = 5;
const sha256Pattern = /^[0-9a-f]{64}$/;

type VerifiedSourceRow = {
	readonly anchorKind?: string;
	readonly anchorkind?: string;
	readonly archiveUrl?: string;
	readonly archiveurl?: string;
	readonly archiveUrlIdentity?: string;
	readonly archiveurlidentity?: string;
	readonly candidateRemoteId?: string;
	readonly candidateremoteid?: string;
	readonly checkpointLedger?: number | string;
	readonly checkpointledger?: number | string;
	readonly contentDigest?: string;
	readonly contentdigest?: string;
	readonly contentRepresentation?: string;
	readonly contentrepresentation?: string;
	readonly corroboratingSourceCount?: number | string;
	readonly corroboratingsourcecount?: number | string;
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

	const policy = createHistoryArchiveRepairSourceUrlPolicy(hostResolver);
	const candidates = await Promise.all(
		requireRows(value).map((row) => mapRow(row, policy).catch(() => null))
	);
	return candidates.filter(isPresent);
}

function normalizeLimit(limit: number): number {
	if (!Number.isSafeInteger(limit) || limit < 1) return 1;
	return Math.min(limit, maxSourcesPerObject);
}

function requireRows(value: unknown): readonly VerifiedSourceRow[] {
	if (!Array.isArray(value)) {
		throw new Error('Verified checkpoint source query did not return rows');
	}
	const rows: VerifiedSourceRow[] = [];
	for (const item of value as unknown[]) {
		if (typeof item !== 'object' || item === null || Array.isArray(item)) {
			throw new Error(
				'Verified checkpoint source query returned an invalid row'
			);
		}
		rows.push(item);
	}
	return rows;
}

async function mapRow(
	row: VerifiedSourceRow,
	urlPolicy: HistoryArchiveRepairSourceUrlPolicy
): Promise<HistoryArchiveVerifiedCheckpointObjectSource> {
	const archiveUrl = requireString(
		row.archiveUrl ?? row.archiveurl,
		'archiveUrl'
	);
	const archiveUrlIdentity = requireString(
		row.archiveUrlIdentity ?? row.archiveurlidentity,
		'archiveUrlIdentity'
	);
	return {
		anchorKind: requireAnchorKind(row.anchorKind ?? row.anchorkind),
		archiveUrl,
		archiveUrlIdentity,
		candidateRemoteId: requireUuid(
			row.candidateRemoteId ?? row.candidateremoteid,
			'candidateRemoteId'
		),
		checkpointLedger: requireLedger(
			row.checkpointLedger ?? row.checkpointledger
		),
		contentDigest: requireDigest(row.contentDigest ?? row.contentdigest),
		contentRepresentation: requireRepresentation(
			row.contentRepresentation ?? row.contentrepresentation
		),
		corroboratingSourceCount: requirePositiveInteger(
			row.corroboratingSourceCount ?? row.corroboratingsourcecount,
			'corroboratingSourceCount'
		),
		objectUrl: await urlPolicy.requireObjectUrl(
			row.objectUrl ?? row.objecturl,
			archiveUrl,
			archiveUrlIdentity
		),
		proofEvaluatedAt: requireDate(
			row.proofEvaluatedAt ?? row.proofevaluatedat,
			'proofEvaluatedAt'
		),
		proofId: requirePositiveInteger(row.proofId ?? row.proofid, 'proofId'),
		proofVersion: requirePositiveInteger(
			row.proofVersion ?? row.proofversion,
			'proofVersion'
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

function requireAnchorKind(
	value: string | undefined
): 'multi-source' | 'target-digest' {
	if (value === 'multi-source' || value === 'target-digest') return value;
	throw new Error('Verified checkpoint source row has invalid anchorKind');
}

function requireString(value: string | undefined, field: string): string {
	if (typeof value === 'string' && value.length > 0) return value;
	throw new Error(`Verified checkpoint source row is missing ${field}`);
}

function requireUuid(value: string | undefined, field: string): string {
	const uuid = requireString(value, field);
	if (
		/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
			uuid
		)
	) {
		return uuid;
	}
	throw new Error(`Verified checkpoint source row has invalid ${field}`);
}

function requireLedger(value: number | string | undefined): number {
	const ledger = typeof value === 'number' ? value : Number(value);
	if (Number.isSafeInteger(ledger) && ledger >= 0) return ledger;
	throw new Error(
		'Verified checkpoint source row has invalid checkpointLedger'
	);
}

function requireDigest(value: string | undefined): string {
	const digest = requireString(value, 'contentDigest').toLowerCase();
	if (sha256Pattern.test(digest)) return digest;
	throw new Error('Verified checkpoint source row has invalid contentDigest');
}

function requireRepresentation(
	value: string | undefined
): 'canonical-json' | 'uncompressed-xdr' {
	if (value === 'canonical-json' || value === 'uncompressed-xdr') return value;
	throw new Error(
		'Verified checkpoint source row has invalid contentRepresentation'
	);
}

function requireDate(value: Date | string | undefined, field: string): Date {
	const date = value instanceof Date ? value : new Date(value ?? '');
	if (!Number.isNaN(date.getTime())) return date;
	throw new Error(`Verified checkpoint source row has invalid ${field}`);
}

function requirePositiveInteger(
	value: number | string | undefined,
	field: string
): number {
	const number = typeof value === 'number' ? value : Number(value);
	if (Number.isSafeInteger(number) && number > 0) return number;
	throw new Error(`Verified checkpoint source row has invalid ${field}`);
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
				and copy."verificationFacts" #>>
					'{content,representation}' in (
						'canonical-json',
						'uncompressed-xdr'
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
		join history_archive_checkpoint_proof proof
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
			and proof."evaluatedAt" >= candidate."verifiedAt"
			and candidate."updatedAt" <= proof."evaluatedAt"
			and proof."expectedBucketCount" = (
				select count(*)
				from history_archive_checkpoint_bucket_dependency expected_dependency
				where expected_dependency."archiveUrlIdentity" =
					proof."archiveUrlIdentity"
					and expected_dependency."checkpointLedger" =
						proof."checkpointLedger"
					and expected_dependency."createdAt" <= proof."evaluatedAt"
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
					and proof_input."verifiedAt" <= proof."evaluatedAt"
					and proof_input."updatedAt" <= proof."evaluatedAt"
			) = 4 + case
				when proof."scpObjectRemoteId" is null then 0 else 1
			end
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
						dependency."createdAt" > proof."evaluatedAt"
						or bucket."remoteId" is null
						or bucket.status <> 'verified'
						or bucket."verifiedAt" is null
						or bucket."verifiedAt" > proof."evaluatedAt"
						or bucket."updatedAt" > proof."evaluatedAt"
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
						and predecessor."verifiedAt" <= proof."evaluatedAt"
						and predecessor."updatedAt" <= proof."evaluatedAt"
				)
			)
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
