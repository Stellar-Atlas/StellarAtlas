import type { EntityManager } from 'typeorm';
import { ArchiveEvidenceReadModelUnavailableError } from '../../../domain/known-archive-evidence/ArchiveEvidenceReadModelUnavailableError.js';
import type { KnownArchiveObjectPageRequest } from '../../../domain/known-archive-evidence/KnownArchiveEvidenceRepository.js';
import { HistoryArchiveObject } from '../../../domain/history-archive-object/HistoryArchiveObject.js';
import { createObjectFromRow } from './HistoryArchiveObjectRowMapper.js';
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

type ActiveObjectRow = {
	readonly archiveUrlIdentity?: string;
	readonly archiveurlidentity?: string;
	readonly hostIdentity?: string;
	readonly hostidentity?: string;
};

type HostThrottleRow = {
	readonly blockedUntil?: Date | string;
	readonly blockeduntil?: Date | string;
	readonly hostIdentity?: string;
	readonly hostidentity?: string;
};

type ObjectRow = Parameters<typeof createObjectFromRow>[0];

export async function findKnownArchiveObjectPage(
	manager: EntityManager,
	archiveUrlIdentities: readonly string[],
	page: KnownArchiveObjectPageRequest
): Promise<{
	readonly objects: HistoryArchiveObject[];
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
		page.limit + 1
	]);
	const objects = requireObjectRows(objectResult).map(createObjectFromRow);
	if (objects.length > 0) await assignDelayReasons(manager, objects);

	return {
		objects,
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
	return isQueryRow(value);
}

function isQueryRow(
	value: unknown
): value is Readonly<Record<string, unknown>> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function assignDelayReasons(
	manager: EntityManager,
	objects: readonly HistoryArchiveObject[]
): Promise<void> {
	const hosts = [...new Set(objects.map((object) => object.hostIdentity))];
	const [activeValue, throttleValue] = await Promise.all([
		manager.query(knownArchiveObjectActiveContextSql),
		manager.query(knownArchiveObjectHostThrottleSql, [hosts])
	]);
	const activeRows = requireActiveRows(activeValue);
	const throttles = requireThrottleRows(throttleValue);
	const activeByArchive = countBy(
		activeRows,
		(row) => row.archiveUrlIdentity ?? row.archiveurlidentity
	);
	const activeByHost = countBy(
		activeRows,
		(row) => row.hostIdentity ?? row.hostidentity
	);
	const blockedByHost = new Map(
		throttles.map((row) => [
			requireRowString(row.hostIdentity ?? row.hostidentity, 'hostIdentity'),
			requireRowDate(row.blockedUntil ?? row.blockeduntil, 'blockedUntil')
		])
	);
	const now = new Date();

	for (const object of objects) {
		object.delayReason = objectDelayReason(object, {
			activeArchive: activeByArchive.get(object.archiveUrlIdentity) ?? 0,
			activeHost: activeByHost.get(object.hostIdentity) ?? 0,
			activeTotal: activeRows.length,
			blockedUntil: blockedByHost.get(object.hostIdentity) ?? null,
			now
		});
	}
}

function objectDelayReason(
	object: HistoryArchiveObject,
	context: {
		readonly activeArchive: number;
		readonly activeHost: number;
		readonly activeTotal: number;
		readonly blockedUntil: Date | null;
		readonly now: Date;
	}
): HistoryArchiveObject['delayReason'] {
	if (object.status === 'scanning') {
		return { code: 'object-already-active', until: null };
	}
	if (object.status !== 'pending' && object.status !== 'failed') return null;
	if ((object.executionDisposition ?? 'deferred') !== 'executable') {
		return {
			code:
				object.executionDisposition === null
					? 'legacy-deferred'
					: 'planning-deferred',
			until: null
		};
	}
	if (context.blockedUntil !== null) {
		return { code: 'host-backoff', until: context.blockedUntil.toISOString() };
	}
	if (
		object.nextAttemptAt !== null &&
		object.nextAttemptAt.getTime() > context.now.getTime()
	) {
		return { code: 'retry-window', until: object.nextAttemptAt.toISOString() };
	}
	if (object.status === 'pending' && object.dependencyReady !== true) {
		return { code: 'missing-dependency', until: null };
	}
	if (context.activeTotal >= maxActiveObjectsTotal) {
		return { code: 'global-active-cap', until: null };
	}
	if (context.activeArchive >= maxActiveObjectsPerArchive) {
		return { code: 'archive-active-cap', until: null };
	}
	if (context.activeHost >= maxActiveObjectsPerHost) {
		return { code: 'host-active-cap', until: null };
	}
	return null;
}

function requireActiveRows(value: unknown): readonly ActiveObjectRow[] {
	return requireRows(value, 'active context');
}

function requireThrottleRows(value: unknown): readonly HostThrottleRow[] {
	return requireRows(value, 'host throttle');
}

function requireRows<T extends object>(
	value: unknown,
	name: string
): readonly T[] {
	if (!Array.isArray(value) || value.some((row) => !isQueryRow(row))) {
		throw new Error(`Known archive object ${name} returned invalid rows`);
	}
	return value as T[];
}

function countBy<T>(
	rows: readonly T[],
	key: (row: T) => string | undefined
): ReadonlyMap<string, number> {
	const counts = new Map<string, number>();
	for (const row of rows) {
		const value = requireRowString(key(row), 'active context identity');
		counts.set(value, (counts.get(value) ?? 0) + 1);
	}
	return counts;
}

function requireRowString(value: string | undefined, field: string): string {
	if (typeof value === 'string' && value.length > 0) return value;
	throw new Error(`Known archive object row is missing ${field}`);
}

function requireRowDate(value: Date | string | undefined, field: string): Date {
	const date = value instanceof Date ? value : new Date(value ?? '');
	if (!Number.isNaN(date.getTime())) return date;
	throw new Error(`Known archive object row has invalid ${field}`);
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
	with requested_roots as materialized (
		select distinct identity as "archiveUrlIdentity"
		from unnest($1::text[]) requested(identity)
		where $2::text is null or identity = $2::text
	)
	select candidate.*
	from requested_roots requested_root
	cross join lateral (
		select archive_object.*
		from history_archive_object_queue archive_object
		where ${objectCandidateFilterSql}
		order by
			archive_object."createdAt" desc,
			archive_object."remoteId" desc
		limit $8
	) candidate
	order by candidate."createdAt" desc, candidate."remoteId" desc
	limit $8
`;

export const knownArchiveObjectActiveContextSql = `
	select "archiveUrlIdentity", "hostIdentity"
	from history_archive_object_queue
	where status = 'scanning'
`;

export const knownArchiveObjectHostThrottleSql = `
	select "hostIdentity", max("blockedUntil") as "blockedUntil"
	from history_archive_object_host_throttle
	where "hostIdentity" = any($1::text[])
		and "blockedUntil" > now()
	group by "hostIdentity"
`;
