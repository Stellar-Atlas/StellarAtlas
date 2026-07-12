import type { EntityManager } from 'typeorm';
import type { HistoryArchiveObjectEvidenceClass } from '../../../domain/history-archive-object/HistoryArchiveObjectRetryPolicy.js';
import type {
	KnownArchiveFailurePageRequest,
	KnownArchiveFailureReadModel
} from '../../../domain/known-archive-evidence/KnownArchiveEvidenceRepository.js';
import {
	createObjectFromRow,
	extractRows,
	type RawObjectQueryResult
} from './HistoryArchiveObjectRowMapper.js';
import { requireNumber, type NumericValue } from './ScanJobRowMapper.js';

export type KnownArchiveFailurePageKind = 'remote' | 'infrastructure';

type FailureRow = Parameters<typeof createObjectFromRow>[0] & {
	readonly evidenceClass?: string;
	readonly evidenceclass?: string;
};

export async function findKnownArchiveFailurePage(
	manager: EntityManager,
	archiveUrlIdentities: readonly string[],
	page: KnownArchiveFailurePageRequest,
	kind: KnownArchiveFailurePageKind
): Promise<{
	readonly failures: readonly KnownArchiveFailureReadModel[];
	readonly total: number;
}> {
	if (archiveUrlIdentities.length === 0) return { failures: [], total: 0 };

	const filterParams = [
		archiveUrlIdentities,
		page.filters.archiveUrlIdentity,
		page.filters.objectType,
		page.snapshotAt
	];
	let total = page.snapshotTotal;
	if (total === null) {
		const countRows = (await manager.query(
			knownArchiveFailureCountSql(kind),
			filterParams
		)) as readonly FailureCountRow[];
		const [countRow] = countRows;
		total = requireNumber(
			countRow?.failureCount ?? countRow?.failurecount ?? 0,
			'failureCount'
		);
	}
	const result = await manager.query(knownArchiveFailurePageSql(kind), [
		...filterParams,
		page.before?.at ?? null,
		page.before?.remoteId ?? null,
		page.limit + 1
	]);

	return {
		failures: extractRows(result as RawObjectQueryResult).map((row) => {
			const failureRow = row as FailureRow;
			return {
				evidenceClass: requireEvidenceClass(
					failureRow.evidenceClass ?? failureRow.evidenceclass
				),
				object: createObjectFromRow(row)
			};
		}),
		total
	};
}

type FailureCountRow = {
	readonly failureCount?: NumericValue;
	readonly failurecount?: NumericValue;
};

export function knownArchiveFailureCountSql(
	kind: KnownArchiveFailurePageKind
): string {
	return `
		select count(*) as "failureCount"
		from history_archive_object_queue archive_object
		where ${knownArchiveFailureFilterSql(kind)}
	`;
}

export function knownArchiveFailurePageSql(
	kind: KnownArchiveFailurePageKind
): string {
	const evidenceClassSql =
		kind === 'remote' ? "'archive-object'" : "'worker-infrastructure'";

	return `
		select archive_object.*, ${evidenceClassSql} as "evidenceClass"
		from history_archive_object_queue archive_object
		where ${knownArchiveFailureFilterSql(kind)}
			and (
				$5::timestamptz is null
				or (
					archive_object."createdAt",
					archive_object."remoteId"
				) < ($5::timestamptz, $6::uuid)
			)
		order by
			archive_object."createdAt" desc,
			archive_object."remoteId" desc
		limit $7
	`;
}

function knownArchiveFailureFilterSql(
	kind: KnownArchiveFailurePageKind
): string {
	const evidencePredicate =
		kind === 'remote'
			? `archive_object."failureChannel" = 'archive_evidence'`
			: `archive_object."failureChannel" = 'scanner_issue'`;

	return `archive_object."archiveUrlIdentity" = any($1::text[])
		and ($2::text is null or archive_object."archiveUrlIdentity" = $2::text)
		and ($3::text is null or archive_object."objectType" = $3::text)
		and archive_object."createdAt" <= $4::timestamptz
		and archive_object.status = 'failed'
		and ${evidencePredicate}`;
}

function requireEvidenceClass(
	value: string | undefined
): HistoryArchiveObjectEvidenceClass {
	if (
		value === 'archive-object' ||
		value === 'worker-infrastructure' ||
		value === 'coordinator-infrastructure'
	) {
		return value;
	}
	throw new Error('Known archive failure row has invalid evidence class');
}
