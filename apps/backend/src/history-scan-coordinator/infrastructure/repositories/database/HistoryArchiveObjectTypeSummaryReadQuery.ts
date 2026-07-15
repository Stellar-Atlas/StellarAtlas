import type { EntityManager } from 'typeorm';
import type {
	HistoryArchiveObjectTypeSummaryV1,
	HistoryArchiveObjectTypeV1
} from 'shared';
import { requireNumber, type NumericValue } from './ScanJobRowMapper.js';

type RollupReadinessRow = {
	readonly ready?: boolean;
};

type ObjectTypeSummaryRow = {
	readonly activeObjects?: NumericValue;
	readonly activeobjects?: NumericValue;
	readonly objectType?: string;
	readonly objecttype?: string;
	readonly pendingObjects?: NumericValue;
	readonly pendingobjects?: NumericValue;
	readonly totalObjects?: NumericValue;
	readonly totalobjects?: NumericValue;
	readonly verifiedObjects?: NumericValue;
	readonly verifiedobjects?: NumericValue;
};

export class HistoryArchiveObjectTypeSummaryUnavailableError extends Error {
	constructor(reason: 'incomplete' | 'unavailable', cause?: unknown) {
		super(
			`Archive object type summary rollup is ${reason}`,
			cause === undefined ? undefined : { cause }
		);
		this.name = 'HistoryArchiveObjectTypeSummaryUnavailableError';
	}
}

export async function requireCompleteObjectTypeSummary(
	manager: EntityManager
): Promise<void> {
	let rows: readonly RollupReadinessRow[];
	try {
		rows = (await manager.query(
			objectTypeSummaryReadinessSql
		)) as readonly RollupReadinessRow[];
	} catch (error) {
		throw new HistoryArchiveObjectTypeSummaryUnavailableError(
			'unavailable',
			error
		);
	}

	if (rows[0]?.ready !== true) {
		throw new HistoryArchiveObjectTypeSummaryUnavailableError('incomplete');
	}
}

export async function getObjectTypeSummariesFromRollup(
	manager: EntityManager,
	archiveUrlIdentity: string | null
): Promise<readonly HistoryArchiveObjectTypeSummaryV1[]> {
	const rows = (await manager.query(objectTypeSummarySql, [
		archiveUrlIdentity
	])) as readonly ObjectTypeSummaryRow[];

	return rows.map(mapObjectTypeSummaryRow);
}

function mapObjectTypeSummaryRow(
	row: ObjectTypeSummaryRow
): HistoryArchiveObjectTypeSummaryV1 {
	const totalObjects = numberField(row, 'totalObjects');
	const pendingObjects = numberField(row, 'pendingObjects');
	const activeObjects = numberField(row, 'activeObjects');
	const verifiedObjects = numberField(row, 'verifiedObjects');
	const failedObjects =
		totalObjects - pendingObjects - activeObjects - verifiedObjects;
	if (failedObjects < 0) {
		throw new Error('Archive object type summary row has inconsistent counts');
	}

	return {
		activeObjects,
		failedObjects,
		objectType: requireObjectType(row.objectType ?? row.objecttype),
		pendingObjects,
		totalObjects,
		verifiedObjects
	};
}

function numberField(
	row: ObjectTypeSummaryRow,
	field: 'activeObjects' | 'pendingObjects' | 'totalObjects' | 'verifiedObjects'
): number {
	const lowerField = field.toLowerCase() as
		'activeobjects' | 'pendingobjects' | 'totalobjects' | 'verifiedobjects';
	return requireNumber(row[field] ?? row[lowerField], field);
}

function requireObjectType(
	value: string | undefined
): HistoryArchiveObjectTypeV1 {
	if (
		value === 'history-archive-state' ||
		value === 'checkpoint-state' ||
		value === 'ledger' ||
		value === 'transactions' ||
		value === 'results' ||
		value === 'scp' ||
		value === 'bucket'
	) {
		return value;
	}

	throw new Error('Archive object summary row is missing object type');
}

export const objectTypeSummaryReadinessSql = `
	select
		(
			"complete" = true
			and "completedAt" is not null
			and "lastObjectId" = "cutoffObjectId"
		) as ready
	from history_archive_object_type_summary_progress
	where id = 1
`;

export const objectTypeSummarySql = `
	select
		"objectType" as "objectType",
		sum("totalObjects") as "totalObjects",
		sum("pendingObjects") as "pendingObjects",
		sum("scanningObjects") as "activeObjects",
		sum("verifiedObjects") as "verifiedObjects"
	from history_archive_object_type_summary
	where ($1::text is null or "archiveUrlIdentity" = $1::text)
	group by "objectType"
	order by case "objectType"
		when 'history-archive-state' then 0
		when 'checkpoint-state' then 1
		when 'ledger' then 2
		when 'transactions' then 3
		when 'results' then 4
		when 'scp' then 5
		when 'bucket' then 6
		else 7
	end
`;
