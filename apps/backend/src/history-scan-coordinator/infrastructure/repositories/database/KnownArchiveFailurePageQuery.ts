import type { EntityManager } from 'typeorm';
import type { HistoryArchiveObjectEvidenceClass } from '../../../domain/history-archive-object/HistoryArchiveObjectRetryPolicy.js';
import type {
	KnownArchiveFailurePageRequest,
	KnownArchiveFailureReadModel
} from '../../../domain/known-archive-evidence/KnownArchiveEvidenceRepository.js';
import { createObjectFromRow } from './HistoryArchiveObjectRowMapper.js';
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
		const countResult: unknown = await manager.query(
			knownArchiveFailureCountSql(kind),
			filterParams
		);
		const countRows = requireFailureCountRows(countResult);
		const [countRow] = countRows;
		if ((countRow?.rollupComplete ?? countRow?.rollupcomplete) !== true) {
			throw new Error('Archive failure evidence rollup is not ready');
		}
		total = requireNumber(
			countRow?.failureCount ?? countRow?.failurecount ?? 0,
			'failureCount'
		);
		if (total < 0) {
			throw new Error('Archive failure evidence rollup is inconsistent');
		}
	}
	if (total === 0) return { failures: [], total };

	const result: unknown = await manager.query(
		knownArchiveFailurePageSql(kind),
		[
			...filterParams,
			page.before?.at ?? null,
			page.before?.remoteId ?? null,
			page.limit + 1
		]
	);

	return {
		failures: requireFailurePageRows(result).map((row) => {
			return {
				evidenceClass: requireEvidenceClass(
					row.evidenceClass ?? row.evidenceclass
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
	readonly rollupComplete?: boolean;
	readonly rollupcomplete?: boolean;
};

export function knownArchiveFailureCountSql(
	kind: KnownArchiveFailurePageKind
): string {
	const rootSummaryColumn =
		kind === 'remote' ? '"remoteFailureObjects"' : '"workerIssueObjects"';
	const typeSummaryColumn =
		kind === 'remote' ? '"remoteFailureObjects"' : '"scannerIssueObjects"';
	const evidencePredicate =
		kind === 'remote'
			? `archive_object."failureChannel" = 'archive_evidence'`
			: `archive_object."failureChannel" = 'scanner_issue'`;

	return `
		with requested_roots as materialized (
			select distinct identity as "archiveUrlIdentity"
			from unnest($1::text[]) requested(identity)
			where $2::text is null or identity = $2::text
		), rollup_state as (
			select case
				when $3::text is null then coalesce((
					select "complete"
					from history_archive_evidence_root_summary_progress
					where id = 1
				), false)
				else coalesce((
					select "complete"
					from history_archive_object_type_summary_progress
					where id = 1
				), false)
			end as "rollupComplete"
		), summary_count as (
			select coalesce(sum(case
				when $3::text is null
					then coalesce(root_summary.${rootSummaryColumn}, 0)
				else coalesce(type_summary.${typeSummaryColumn}, 0)
			end), 0) as count
			from requested_roots requested_root
			left join history_archive_evidence_root_summary root_summary
				on root_summary."archiveUrlIdentity" =
					requested_root."archiveUrlIdentity"
			left join history_archive_object_type_summary type_summary
				on type_summary."archiveUrlIdentity" =
					requested_root."archiveUrlIdentity"
				and type_summary."objectType" = $3::text
		), future_count as (
			select coalesce(sum(future_objects.count), 0) as count
			from requested_roots requested_root
			cross join lateral (
				select count(*) as count
				from history_archive_object_queue archive_object
				where archive_object."archiveUrlIdentity" =
						requested_root."archiveUrlIdentity"
					and ($3::text is null
						or archive_object."objectType" = $3::text)
					and archive_object."createdAt" > $4::timestamptz
					and archive_object.status = 'failed'
					and ${evidencePredicate}
			) future_objects
		)
		select
			summary_count.count - future_count.count as "failureCount",
			rollup_state."rollupComplete"
		from summary_count
		cross join future_count
		cross join rollup_state
	`;
}

export function knownArchiveFailurePageSql(
	kind: KnownArchiveFailurePageKind
): string {
	const evidenceClassSql =
		kind === 'remote' ? "'archive-object'" : "'worker-infrastructure'";

	return `
		with requested_roots as materialized (
			select distinct identity as "archiveUrlIdentity"
			from unnest($1::text[]) requested(identity)
			where $2::text is null or identity = $2::text
		), page_keys as materialized (
			select candidate."createdAt", candidate."remoteId"
			from requested_roots requested_root
			cross join lateral (
				select archive_object."createdAt", archive_object."remoteId"
				from history_archive_object_queue archive_object
				where ${knownArchiveFailureCandidateFilterSql(kind)}
				order by archive_object."createdAt" desc,
					archive_object."remoteId" desc
				limit $7
			) candidate
			order by candidate."createdAt" desc, candidate."remoteId" desc
			limit $7
		)
		select archive_object.*, ${evidenceClassSql} as "evidenceClass"
		from page_keys page_key
		join history_archive_object_queue archive_object
			on archive_object."remoteId" = page_key."remoteId"
		order by page_key."createdAt" desc, page_key."remoteId" desc
	`;
}

function knownArchiveFailureCandidateFilterSql(
	kind: KnownArchiveFailurePageKind
): string {
	const evidencePredicate =
		kind === 'remote'
			? `archive_object."failureChannel" = 'archive_evidence'`
			: `archive_object."failureChannel" = 'scanner_issue'`;

	return `archive_object."archiveUrlIdentity" =
			requested_root."archiveUrlIdentity"
		and ($3::text is null or archive_object."objectType" = $3::text)
		and archive_object."createdAt" <= $4::timestamptz
		and archive_object.status = 'failed'
		and ${evidencePredicate}
		and (
			$5::timestamptz is null
			or (
				archive_object."createdAt",
				archive_object."remoteId"
			) < ($5::timestamptz, $6::uuid)
		)`;
}

function requireFailureCountRows(value: unknown): readonly FailureCountRow[] {
	if (!Array.isArray(value)) {
		throw new Error('Known archive failure count did not return rows');
	}
	const values: unknown[] = value;
	const rows: FailureCountRow[] = [];
	for (const item of values) {
		if (!isFailureCountRow(item)) {
			throw new Error('Known archive failure count returned an invalid row');
		}
		rows.push(item);
	}
	return rows;
}

function requireFailurePageRows(value: unknown): readonly FailureRow[] {
	if (!Array.isArray(value)) {
		throw new Error('Known archive failure page did not return rows');
	}
	const values: unknown[] = value;
	const rows: FailureRow[] = [];
	for (const item of values) {
		if (!isFailurePageRow(item)) {
			throw new Error('Known archive failure page returned an invalid row');
		}
		rows.push(item);
	}
	return rows;
}

function isFailureCountRow(value: unknown): value is FailureCountRow {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFailurePageRow(value: unknown): value is FailureRow {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
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
