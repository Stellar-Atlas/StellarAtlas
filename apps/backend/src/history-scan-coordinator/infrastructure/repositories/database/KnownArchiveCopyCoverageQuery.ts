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
	with requested_failures as (
		select source.*
		from history_archive_object_queue source
		join history_archive_state_snapshot source_state
			on source_state."archiveUrlIdentity" = source."archiveUrlIdentity"
			and source_state.status = 'available'
			and nullif(source_state."networkPassphrase", '') is not null
		where source."remoteId" = any($1::uuid[])
			and source."createdAt" <= $4::timestamptz
	),
	source_proofs as (
		select
			source.*,
			source_state."networkPassphrase",
			coalesce(
				verified_event."verificationFacts",
				source."verificationFacts"
			) as "proofFacts"
		from requested_failures source
		join history_archive_state_snapshot source_state
			on source_state."archiveUrlIdentity" = source."archiveUrlIdentity"
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
	copy_proofs as (
		select
			copy.*,
			copy_state."networkPassphrase",
			coalesce(
				latest_event."verificationFacts",
				copy."verificationFacts"
			) as "proofFacts",
			coalesce(latest_event."createdAt", copy."verifiedAt") as "proofAt"
		from history_archive_object_queue copy
		join history_archive_state_snapshot copy_state
			on copy_state."archiveUrlIdentity" = copy."archiveUrlIdentity"
			and copy_state.status = 'available'
			and nullif(copy_state."networkPassphrase", '') is not null
		left join lateral (
			select
				event."createdAt",
				event."eventType",
				event."verificationFacts"
			from history_archive_object_event event
			where event."objectRemoteId" = copy."remoteId"
				and event."createdAt" <= $4::timestamptz
			order by event."createdAt" desc, event."remoteId" desc
			limit 1
		) latest_event on true
		where copy."createdAt" <= $4::timestamptz
			and char_length(copy."objectUrl") between 1 and 2048
			and copy."objectUrl" ~* '^https?://[^/?#[:space:]@]+'
			and copy."objectUrl" !~ '[[:space:][:cntrl:]]'
			and (
				latest_event."eventType" = 'verified'
				or (
					latest_event."eventType" is null
					and copy.status = 'verified'
					and copy."updatedAt" <= $4::timestamptz
				)
			)
	),
	copy_candidates as (
		select
			source."remoteId" as "sourceRemoteId",
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
		from source_proofs source
		join copy_proofs copy
			on copy."objectType" = source."objectType"
			and copy."objectKey" = source."objectKey"
			and copy."archiveUrlIdentity" <> source."archiveUrlIdentity"
			and copy."networkPassphrase" = source."networkPassphrase"
			and (
				(
					source."objectType" = 'bucket'
					and source."bucketHash" ~ '^[0-9a-fA-F]{64}$'
					and lower(copy."bucketHash") = lower(source."bucketHash")
					and copy."proofFacts" -> 'bucketObject' ->> 'matched' = 'true'
					and lower(
						copy."proofFacts" -> 'bucketObject' ->> 'expectedBucketHash'
					) = lower(source."bucketHash")
				)
				or (
					source."objectType" <> 'bucket'
					and copy."proofFacts" -> 'content' ->> 'algorithm' = 'sha256'
					and copy."proofFacts" -> 'content' ->> 'digest'
						~ '^[0-9a-fA-F]{64}$'
					and nullif(
						copy."proofFacts" -> 'content' ->> 'representation',
						''
					) is not null
					and (
						(
							source."proofFacts" -> 'content' ->> 'algorithm' = 'sha256'
							and source."proofFacts" -> 'content' ->> 'digest'
								~ '^[0-9a-fA-F]{64}$'
							and lower(copy."proofFacts" -> 'content' ->> 'digest') =
								lower(source."proofFacts" -> 'content' ->> 'digest')
							and copy."proofFacts" -> 'content' ->> 'representation' =
								source."proofFacts" -> 'content' ->> 'representation'
						)
						or (
							source."objectType" in (
								'checkpoint-state',
								'ledger',
								'transactions',
								'results'
							)
							and source."checkpointLedger" is not null
							and copy."checkpointLedger" = source."checkpointLedger"
							and not coalesce(
								source."proofFacts" -> 'content' ->> 'algorithm' = 'sha256'
								and source."proofFacts" -> 'content' ->> 'digest'
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
