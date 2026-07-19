import type { EntityManager } from 'typeorm';
import { ArchiveEvidenceReadModelUnavailableError } from '../../../domain/known-archive-evidence/ArchiveEvidenceReadModelUnavailableError.js';
import type { KnownArchiveObjectPageRequest } from '../../../domain/known-archive-evidence/KnownArchiveEvidenceRepository.js';
import { createObjectFromRow } from './HistoryArchiveObjectRowMapper.js';
import { historyArchiveObjectDependencySatisfiedSql } from './HistoryArchiveObjectDependencySql.js';
import { requireNumber, type NumericValue } from './ScanJobRowMapper.js';

const maxActiveObjectsPerArchive = 1;
const maxActiveObjectsPerHost = 2;
const maxActiveObjectsTotal = 24;

type CountRow = {
	readonly objectCount?: NumericValue;
	readonly objectcount?: NumericValue;
	readonly rollupComplete?: boolean;
	readonly rollupcomplete?: boolean;
};

type ObjectRow = Parameters<typeof createObjectFromRow>[0];

export async function findKnownArchiveObjectPage(
	manager: EntityManager,
	archiveUrlIdentities: readonly string[],
	page: KnownArchiveObjectPageRequest
): Promise<{
	readonly objects: ReturnType<typeof createObjectFromRow>[];
	readonly total: number;
}> {
	if (archiveUrlIdentities.length === 0) return { objects: [], total: 0 };

	const params = [
		archiveUrlIdentities,
		page.filters.archiveUrlIdentity,
		page.filters.objectType,
		page.filters.status,
		page.snapshotAt
	];
	let total = page.snapshotTotal;
	if (total === null) {
		const countResult: unknown = await manager.query(
			knownArchiveObjectCountSql,
			params
		);
		const countRows = requireCountRows(countResult);
		const [countRow] = countRows;
		if ((countRow?.rollupComplete ?? countRow?.rollupcomplete) !== true) {
			throw new ArchiveEvidenceReadModelUnavailableError(
				'Archive object evidence rollup is not ready'
			);
		}
		total = requireNumber(
			countRow?.objectCount ?? countRow?.objectcount ?? 0,
			'objectCount'
		);
	}
	if (total === 0) return { objects: [], total };

	const objectResult: unknown = await manager.query(knownArchiveObjectPageSql, [
		...params,
		page.before?.at ?? null,
		page.before?.remoteId ?? null,
		page.limit + 1,
		maxActiveObjectsPerArchive,
		maxActiveObjectsTotal,
		maxActiveObjectsPerHost
	]);

	return {
		objects: requireObjectRows(objectResult).map(createObjectFromRow),
		total
	};
}

function requireCountRows(value: unknown): readonly CountRow[] {
	if (!Array.isArray(value)) {
		throw new Error('Known archive object count did not return rows');
	}
	const values: unknown[] = value;
	const rows: CountRow[] = [];
	for (const item of values) {
		if (!isCountRow(item)) {
			throw new Error('Known archive object count returned an invalid row');
		}
		rows.push(item);
	}
	return rows;
}

function requireObjectRows(value: unknown): readonly ObjectRow[] {
	if (!Array.isArray(value)) {
		throw new Error('Known archive object page did not return rows');
	}
	const values: unknown[] = value;
	const rows: ObjectRow[] = [];
	for (const item of values) {
		if (!isObjectRow(item)) {
			throw new Error('Known archive object page returned an invalid row');
		}
		rows.push(item);
	}
	return rows;
}

function isCountRow(value: unknown): value is CountRow {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isObjectRow(value: unknown): value is ObjectRow {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const objectCandidateFilterSql = `
	archive_object."archiveUrlIdentity" = requested_root."archiveUrlIdentity"
	and ($3::text is null or archive_object."objectType" = $3::text)
	and ($4::text is null or archive_object.status = $4::text)
	and archive_object."createdAt" <= $5::timestamptz
	and (
		$6::timestamptz is null
		or (
			archive_object."createdAt",
			archive_object."remoteId"
		) < ($6::timestamptz, $7::uuid)
	)
`;

export const knownArchiveObjectCountSql = `
	with requested_roots as materialized (
		select distinct identity as "archiveUrlIdentity"
		from unnest($1::text[]) requested(identity)
		where $2::text is null or identity = $2::text
	), rollup_state as (
		select case
			when $3::text is null then coalesce((
				select "complete" and "lastObjectId" = "cutoffObjectId"
				from history_archive_evidence_root_summary_progress
				where id = 1
			), false)
			else coalesce((
				select "complete" and "lastObjectId" = "cutoffObjectId"
					and "completedAt" is not null
				from history_archive_object_type_summary_progress
				where id = 1
			), false)
		end as "rollupComplete"
	), summary_count as (
		select coalesce(sum(case
			when $3::text is null then ${summaryStatusCountSql('root_summary', 'activeObjects')}
			else ${summaryStatusCountSql('type_summary', 'scanningObjects')}
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
				and ($4::text is null or archive_object.status = $4::text)
				and archive_object."createdAt" > $5::timestamptz
		) future_objects
	)
	select
		greatest(summary_count.count - future_count.count, 0) as "objectCount",
		rollup_state."rollupComplete"
	from summary_count
	cross join future_count
	cross join rollup_state
`;

function summaryStatusCountSql(
	alias: string,
	activeColumn: 'activeObjects' | 'scanningObjects'
): string {
	return `case
		when $4::text is null then coalesce(${alias}."totalObjects", 0)
		when $4::text = 'pending' then coalesce(${alias}."pendingObjects", 0)
		when $4::text = 'scanning' then coalesce(${alias}."${activeColumn}", 0)
		when $4::text = 'verified' then coalesce(${alias}."verifiedObjects", 0)
		when $4::text = 'failed' then greatest(
			coalesce(${alias}."totalObjects", 0)
				- coalesce(${alias}."pendingObjects", 0)
				- coalesce(${alias}."${activeColumn}", 0)
				- coalesce(${alias}."verifiedObjects", 0),
			0
		)
		else 0
	end`;
}

export const knownArchiveObjectPageSql = `
	with
	requested_roots as materialized (
		select distinct identity as "archiveUrlIdentity"
		from unnest($1::text[]) requested(identity)
		where $2::text is null or identity = $2::text
	),
	page_keys as materialized (
		select candidate."createdAt", candidate."remoteId"
		from requested_roots requested_root
		cross join lateral (
			select archive_object."createdAt", archive_object."remoteId"
			from history_archive_object_queue archive_object
			where ${objectCandidateFilterSql}
			order by
				archive_object."createdAt" desc,
				archive_object."remoteId" desc
			limit $8
		) candidate
		order by candidate."createdAt" desc, candidate."remoteId" desc
		limit $8
	),
	active_total as (
		select count(*)::int as active_count
		from history_archive_object_queue
		where status = 'scanning'
	),
	active_archive as (
		select "archiveUrlIdentity", count(*)::int as active_count
		from history_archive_object_queue
		where status = 'scanning'
		group by "archiveUrlIdentity"
	),
	active_host as (
		select "hostIdentity", count(*)::int as active_count
		from history_archive_object_queue
		where status = 'scanning'
		group by "hostIdentity"
	),
	host_throttle as (
		select "hostIdentity", max("blockedUntil") as "blockedUntil"
		from history_archive_object_host_throttle
		where "blockedUntil" > now()
		group by "hostIdentity"
	)
	select
		archive_object.*,
		case
			when archive_object.status = 'scanning'
				then 'object-already-active'
			when archive_object.status not in ('pending', 'failed')
				then null
			when coalesce(
				archive_object."executionDisposition",
				'deferred'
			) <> 'executable' then case
				when archive_object."executionDisposition" is null
					then 'legacy-deferred'
				else 'planning-deferred'
			end
			when host_throttle."blockedUntil" is not null
				then 'host-backoff'
			when archive_object."nextAttemptAt" > now()
				then 'retry-window'
			when archive_object.status = 'pending' and not coalesce(
				${historyArchiveObjectDependencySatisfiedSql('archive_object')},
				false
			)
				then 'missing-dependency'
			when active_total.active_count >= $10
				then 'global-active-cap'
			when coalesce(active_archive.active_count, 0) >= $9
				then 'archive-active-cap'
			when coalesce(active_host.active_count, 0) >= $11
				then 'host-active-cap'
			else null
		end as "delayReasonCode",
		case
			when archive_object.status not in ('pending', 'failed')
				then null
			when coalesce(
				archive_object."executionDisposition",
				'deferred'
			) <> 'executable' then null
			when host_throttle."blockedUntil" is not null
				then host_throttle."blockedUntil"
			when archive_object."nextAttemptAt" > now()
				then archive_object."nextAttemptAt"
			else null
		end as "delayReasonUntil"
	from page_keys page_key
	join history_archive_object_queue archive_object
		on archive_object."remoteId" = page_key."remoteId"
	cross join active_total
	left join active_archive
		on active_archive."archiveUrlIdentity" =
			archive_object."archiveUrlIdentity"
	left join active_host
		on active_host."hostIdentity" = archive_object."hostIdentity"
	left join host_throttle
		on host_throttle."hostIdentity" = archive_object."hostIdentity"
	order by
		page_key."createdAt" desc,
		page_key."remoteId" desc
`;
