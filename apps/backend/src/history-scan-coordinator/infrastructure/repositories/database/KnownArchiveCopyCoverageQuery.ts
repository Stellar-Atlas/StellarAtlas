import type { EntityManager } from 'typeorm';
import type { HistoryArchiveObject } from '../../../domain/history-archive-object/HistoryArchiveObject.js';
import type {
	KnownArchiveObjectCopyCoverageReadModel,
	KnownArchiveVerifiedCopyReadModel,
	KnownArchiveVerifiedCopyRelation
} from '../../../domain/known-archive-evidence/KnownArchiveEvidenceRepository.js';
import { requireNumber, type NumericValue } from './ScanJobRowMapper.js';

type CopyRow = {
	readonly archiveUrl?: string;
	readonly archiveurl?: string;
	readonly archiveUrlIdentity?: string;
	readonly archiveurlidentity?: string;
	readonly copyCount?: NumericValue;
	readonly copycount?: NumericValue;
	readonly objectUrl?: string;
	readonly objecturl?: string;
	readonly relation?: string;
	readonly remoteId?: string;
	readonly remoteid?: string;
	readonly sourceRemoteId?: string;
	readonly sourceremoteid?: string;
	readonly verifiedAt?: Date | string | null;
	readonly verifiedat?: Date | string | null;
};

export async function findKnownArchiveCopyCoverage(
	manager: EntityManager,
	sources: readonly HistoryArchiveObject[],
	sameOrganizationArchiveUrlIdentities: readonly string[],
	copyLimit: number,
	snapshotAt: Date
): Promise<readonly KnownArchiveObjectCopyCoverageReadModel[]> {
	if (sources.length === 0) return [];

	const rows = (await manager.query(knownArchiveCopyCoverageSql, [
		sources.map((source) => source.remoteId),
		sameOrganizationArchiveUrlIdentities,
		copyLimit,
		snapshotAt
	])) as readonly CopyRow[];

	return groupCopyRows(sources, rows);
}

function groupCopyRows(
	sources: readonly HistoryArchiveObject[],
	rows: readonly CopyRow[]
): readonly KnownArchiveObjectCopyCoverageReadModel[] {
	const coverage = new Map<string, MutableCoverage>(
		sources.map((source) => [
			source.remoteId,
			{
				network: {
					copies: [] as KnownArchiveVerifiedCopyReadModel[],
					count: 0
				},
				sameOrganization: {
					copies: [] as KnownArchiveVerifiedCopyReadModel[],
					count: 0
				},
				sourceRemoteId: source.remoteId
			} satisfies MutableCoverage
		])
	);

	for (const row of rows) {
		const sourceRemoteId = requireString(
			row.sourceRemoteId ?? row.sourceremoteid,
			'sourceRemoteId'
		);
		const target = coverage.get(sourceRemoteId);
		if (target === undefined) {
			throw new Error(
				'Archive copy coverage returned an unknown source object'
			);
		}
		const relation = requireRelation(row.relation);
		const copySet =
			relation === 'same-organization'
				? target.sameOrganization
				: target.network;
		copySet.count = requireNumber(row.copyCount ?? row.copycount, 'copyCount');
		copySet.copies.push(mapCopy(row));
	}

	return Array.from(coverage.values());
}

interface MutableCoverage extends KnownArchiveObjectCopyCoverageReadModel {
	readonly network: {
		copies: KnownArchiveVerifiedCopyReadModel[];
		count: number;
	};
	readonly sameOrganization: {
		copies: KnownArchiveVerifiedCopyReadModel[];
		count: number;
	};
}

function mapCopy(row: CopyRow): KnownArchiveVerifiedCopyReadModel {
	return {
		archiveUrl: requireString(row.archiveUrl ?? row.archiveurl, 'archiveUrl'),
		archiveUrlIdentity: requireString(
			row.archiveUrlIdentity ?? row.archiveurlidentity,
			'archiveUrlIdentity'
		),
		objectUrl: requirePublicHttpUrl(row.objectUrl ?? row.objecturl),
		remoteId: requireString(row.remoteId ?? row.remoteid, 'remoteId'),
		verifiedAt: nullableDate(row.verifiedAt ?? row.verifiedat)
	};
}

function requireRelation(
	value: string | undefined
): KnownArchiveVerifiedCopyRelation {
	if (value === 'same-organization' || value === 'network') return value;
	throw new Error('Archive copy coverage row has invalid relation');
}

function requireString(value: string | undefined, field: string): string {
	if (typeof value === 'string' && value.length > 0) return value;
	throw new Error(`Archive copy coverage row is missing ${field}`);
}

function requirePublicHttpUrl(value: string | undefined): string {
	const objectUrl = requireString(value, 'objectUrl');
	if (
		objectUrl.length > 2_048 ||
		objectUrl.trim() !== objectUrl ||
		/[\u0000-\u0020\u007f]/.test(objectUrl)
	) {
		throw new Error('Archive copy coverage row has invalid objectUrl');
	}
	try {
		const parsed = new URL(objectUrl);
		if (
			(parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
			parsed.username === '' &&
			parsed.password === ''
		) {
			return objectUrl;
		}
	} catch {
		// Fall through to the closed public URL error.
	}
	throw new Error('Archive copy coverage row has invalid objectUrl');
}

function nullableDate(value: Date | string | null | undefined): Date | null {
	if (value === null || value === undefined) return null;
	const date = value instanceof Date ? value : new Date(value);
	if (Number.isNaN(date.getTime())) {
		throw new Error('Archive copy coverage row has invalid verifiedAt');
	}
	return date;
}

export const knownArchiveCopyCoverageSql = `
	with requested_failures as not materialized (
		select source."remoteId", source."archiveUrlIdentity", source."objectType",
			source."objectKey", source."bucketHash", source."checkpointLedger",
			source."verificationFacts",
			source_state."networkPassphrase"
		from history_archive_object_queue source
		join history_archive_state_snapshot source_state
			on source_state."archiveUrlIdentity" = source."archiveUrlIdentity"
			and source_state.status = 'available'
			and nullif(source_state."networkPassphrase", '') is not null
		where source."remoteId" = any($1::uuid[])
			and source."createdAt" <= $4::timestamptz
	),
	source_proofs as materialized (
		select
			source."remoteId", source."archiveUrlIdentity", source."objectType",
			source."objectKey", source."bucketHash", source."checkpointLedger",
			source."networkPassphrase",
			coalesce(verified_event."verificationFacts", source."verificationFacts")
				-> 'content' as content
		from requested_failures source
		left join lateral (
			select event."verificationFacts"
			from history_archive_object_event event
			where event."objectRemoteId" = source."remoteId"
				and event."eventType" = 'verified'
				and event."createdAt" <= $4::timestamptz
			order by event."createdAt" desc, event."remoteId" desc
			limit 1
		) verified_event on true
	),
	source_descriptors as materialized (
		select source."remoteId", source."archiveUrlIdentity", source."objectType",
			source."objectKey", source."bucketHash", source."checkpointLedger",
			source."networkPassphrase",
			source.content ->> 'algorithm' as algorithm,
			source.content ->> 'digest' as digest,
			source.content ->> 'representation' as representation
		from source_proofs source
	),
	candidate_copies as not materialized (
		select
			source."remoteId" as "sourceRemoteId",
			source."objectType" as "sourceObjectType",
			source."bucketHash" as "sourceBucketHash",
			source."checkpointLedger" as "sourceCheckpointLedger",
			source.algorithm as "sourceAlgorithm",
			source.digest as "sourceDigest",
			source.representation as "sourceRepresentation",
			copy."archiveUrl",
			copy."archiveUrlIdentity",
			copy."bucketHash",
			copy."checkpointLedger",
			copy."objectUrl",
			copy."remoteId",
			copy.status,
			copy."updatedAt",
			copy."verificationFacts",
			copy."verifiedAt"
		from source_descriptors source
		cross join lateral (
			select candidate."archiveUrl", candidate."archiveUrlIdentity",
				candidate."bucketHash", candidate."checkpointLedger",
				candidate."objectUrl", candidate."remoteId", candidate.status,
				candidate."updatedAt", candidate."verifiedAt",
				candidate."verificationFacts"
			from history_archive_object_queue candidate
			where candidate."objectType" = source."objectType"
				and candidate."objectKey" = source."objectKey"
				and candidate."archiveUrlIdentity" <>
					source."archiveUrlIdentity"
				and candidate."createdAt" <= $4::timestamptz
				and char_length(candidate."objectUrl") between 1 and 2048
				and candidate."objectUrl" ~* '^https?://[^/?#[:space:]@]+'
				and candidate."objectUrl" !~ '[[:space:][:cntrl:]]'
		) copy
		join history_archive_state_snapshot copy_state
			on copy_state."archiveUrlIdentity" = copy."archiveUrlIdentity"
			and copy_state.status = 'available'
			and copy_state."networkPassphrase" =
				source."networkPassphrase"
	),
	copy_proofs as materialized (
		select
			candidate."sourceRemoteId", candidate."sourceObjectType",
			candidate."sourceBucketHash", candidate."sourceCheckpointLedger",
			candidate."sourceAlgorithm", candidate."sourceDigest",
			candidate."sourceRepresentation",
			candidate."archiveUrl", candidate."archiveUrlIdentity",
			candidate."bucketHash", candidate."checkpointLedger",
			candidate."objectUrl", candidate."remoteId",
			facts.content, facts."bucketObject",
			coalesce(latest_event."createdAt", candidate."verifiedAt") as "proofAt"
		from candidate_copies candidate
		left join lateral (
			select
				event."createdAt",
				event."eventType",
				event."verificationFacts"
			from history_archive_object_event event
			where event."objectRemoteId" = candidate."remoteId"
				and event."createdAt" <= $4::timestamptz
			order by event."createdAt" desc, event."remoteId" desc
			limit 1
		) latest_event on true
		cross join lateral jsonb_to_record(
			case when jsonb_typeof(coalesce(
				latest_event."verificationFacts", candidate."verificationFacts"
			)) = 'object' then coalesce(
				latest_event."verificationFacts", candidate."verificationFacts"
			) else '{}'::jsonb end
		) facts(content jsonb, "bucketObject" jsonb)
		where (
				latest_event."eventType" = 'verified'
				or (
					latest_event."eventType" is null
					and candidate.status = 'verified'
					and candidate."updatedAt" <= $4::timestamptz
				)
			)
	),
	copy_descriptors as materialized (
		select copy."sourceRemoteId", copy."sourceObjectType",
			copy."sourceBucketHash", copy."sourceCheckpointLedger",
			copy."sourceAlgorithm", copy."sourceDigest", copy."sourceRepresentation",
			copy."archiveUrl", copy."archiveUrlIdentity", copy."bucketHash",
			copy."checkpointLedger", copy."objectUrl", copy."remoteId", copy."proofAt",
			copy.content ->> 'algorithm' as algorithm,
			copy.content ->> 'digest' as digest,
			copy.content ->> 'representation' as representation,
			copy."bucketObject" ->> 'matched' as "bucketMatched",
			copy."bucketObject" ->> 'expectedBucketHash' as "expectedBucketHash"
		from copy_proofs copy
	),
	copy_candidates as (
		select
			copy."sourceRemoteId",
			case
				when copy."archiveUrlIdentity" = any($2::text[])
					then 'same-organization'
				else 'network'
			end as relation,
			copy."archiveUrl",
			copy."archiveUrlIdentity",
			copy."objectUrl",
			copy."remoteId",
			copy."proofAt" as "verifiedAt"
		from copy_descriptors copy
		where (
				(
					copy."sourceObjectType" = 'bucket'
					and copy."sourceBucketHash" ~ '^[0-9a-fA-F]{64}$'
					and lower(copy."bucketHash") =
						lower(copy."sourceBucketHash")
					and copy."bucketMatched" = 'true'
					and lower(copy."expectedBucketHash") = lower(copy."sourceBucketHash")
				)
				or (
					copy."sourceObjectType" <> 'bucket'
					and copy.algorithm = 'sha256'
					and copy.digest
						~ '^[0-9a-fA-F]{64}$'
					and nullif(
						copy.representation,
						''
					) is not null
					and (
						(
							copy."sourceAlgorithm" =
								'sha256'
							and copy."sourceDigest"
								~ '^[0-9a-fA-F]{64}$'
							and lower(copy.digest) = lower(copy."sourceDigest")
							and copy.representation = copy."sourceRepresentation"
						)
						or (
							copy."sourceObjectType" in (
								'checkpoint-state',
								'ledger',
								'transactions',
								'results',
								'scp'
							)
							and copy."sourceCheckpointLedger" is not null
							and copy."checkpointLedger" =
								copy."sourceCheckpointLedger"
							and not coalesce(
								copy."sourceAlgorithm" =
									'sha256'
								and copy."sourceDigest"
									~ '^[0-9a-fA-F]{64}$',
								false
							)
						)
					)
				)
			)
	),
	ranked_copies as (
		select
			candidate.*,
			count(*) over (
				partition by candidate."sourceRemoteId", candidate.relation
			) as "copyCount",
			row_number() over (
				partition by candidate."sourceRemoteId", candidate.relation
				order by candidate."verifiedAt" desc nulls last,
					candidate."archiveUrlIdentity" asc
			) as sample_rank
		from copy_candidates candidate
	)
	select
		"sourceRemoteId",
		relation,
		"archiveUrl",
		"archiveUrlIdentity",
		"objectUrl",
		"remoteId",
		"verifiedAt",
		"copyCount"
	from ranked_copies
	where sample_rank <= $3
	order by "sourceRemoteId" asc, relation asc, sample_rank asc
`;
