import type { EntityManager } from 'typeorm';
import type {
	HistoryArchiveBucketCoverageV1,
	HistoryArchiveObjectStatusCountsV1,
	HistoryArchiveObjectSummaryV1,
	HistoryArchiveObjectTypeSummaryV1,
	HistoryArchiveObjectTypeV1
} from 'shared';
import { requireNumber, type NumericValue } from './ScanJobRowMapper.js';
import { getCheckpointCoverage } from './HistoryArchiveObjectCheckpointCoverageQuery.js';
import { getHistoryArchiveObjectHostThrottles } from './HistoryArchiveObjectHostThrottleSummaryQuery.js';

interface SummaryOptions {
	readonly archiveUrl?: string | null;
	readonly archiveUrlIdentity?: string | null;
	readonly generatedAt?: Date;
}

type ObjectTypeSummaryRow = {
	readonly objectType?: string;
	readonly objecttype?: string;
	readonly totalObjects?: NumericValue;
	readonly totalobjects?: NumericValue;
	readonly pendingObjects?: NumericValue;
	readonly pendingobjects?: NumericValue;
	readonly activeObjects?: NumericValue;
	readonly activeobjects?: NumericValue;
	readonly verifiedObjects?: NumericValue;
	readonly verifiedobjects?: NumericValue;
	readonly failedObjects?: NumericValue;
	readonly failedobjects?: NumericValue;
};

type BucketCoverageRow = Omit<
	ObjectTypeSummaryRow,
	'objectType' | 'objecttype'
> & {
	readonly uniqueBucketHashes?: NumericValue;
	readonly uniquebuckethashes?: NumericValue;
};

export async function getHistoryArchiveObjectSummary(
	manager: EntityManager,
	options: SummaryOptions = {}
): Promise<HistoryArchiveObjectSummaryV1> {
	const archiveUrlIdentity = options.archiveUrlIdentity ?? null;
	const [objectTypes, buckets, checkpoints, hostThrottles] = await Promise.all([
		getObjectTypeSummaries(manager, archiveUrlIdentity),
		getBucketCoverage(manager, archiveUrlIdentity),
		getCheckpointCoverage(manager, archiveUrlIdentity),
		getHistoryArchiveObjectHostThrottles(manager, archiveUrlIdentity)
	]);
	const totals = sumObjectTypeCounts(objectTypes);

	return {
		...totals,
		archiveUrl: options.archiveUrl ?? null,
		archiveUrlIdentity,
		buckets,
		checkpoints,
		generatedAt: (options.generatedAt ?? new Date()).toISOString(),
		hostThrottles,
		objectTypes,
		scope: archiveUrlIdentity === null ? 'global' : 'archive'
	};
}

async function getObjectTypeSummaries(
	manager: EntityManager,
	archiveUrlIdentity: string | null
): Promise<readonly HistoryArchiveObjectTypeSummaryV1[]> {
	const rows = (await manager.query(objectTypeSummarySql, [
		archiveUrlIdentity
	])) as readonly ObjectTypeSummaryRow[];

	return rows.map(mapObjectTypeSummaryRow);
}

async function getBucketCoverage(
	manager: EntityManager,
	archiveUrlIdentity: string | null
): Promise<HistoryArchiveBucketCoverageV1> {
	const [row] = (await manager.query(bucketCoverageSql, [
		archiveUrlIdentity
	])) as readonly BucketCoverageRow[];

	return {
		activeBucketObjects: requireNumber(
			row?.activeObjects ?? row?.activeobjects,
			'activeBucketObjects'
		),
		failedBucketObjects: requireNumber(
			row?.failedObjects ?? row?.failedobjects,
			'failedBucketObjects'
		),
		pendingBucketObjects: requireNumber(
			row?.pendingObjects ?? row?.pendingobjects,
			'pendingBucketObjects'
		),
		totalBucketObjects: requireNumber(
			row?.totalObjects ?? row?.totalobjects,
			'totalBucketObjects'
		),
		uniqueBucketHashes: requireNumber(
			row?.uniqueBucketHashes ?? row?.uniquebuckethashes,
			'uniqueBucketHashes'
		),
		verifiedBucketObjects: requireNumber(
			row?.verifiedObjects ?? row?.verifiedobjects,
			'verifiedBucketObjects'
		)
	};
}

function mapObjectTypeSummaryRow(
	row: ObjectTypeSummaryRow
): HistoryArchiveObjectTypeSummaryV1 {
	return {
		activeObjects: requireNumber(
			row.activeObjects ?? row.activeobjects,
			'activeObjects'
		),
		failedObjects: requireNumber(
			row.failedObjects ?? row.failedobjects,
			'failedObjects'
		),
		objectType: requireObjectType(row.objectType ?? row.objecttype),
		pendingObjects: requireNumber(
			row.pendingObjects ?? row.pendingobjects,
			'pendingObjects'
		),
		totalObjects: requireNumber(
			row.totalObjects ?? row.totalobjects,
			'totalObjects'
		),
		verifiedObjects: requireNumber(
			row.verifiedObjects ?? row.verifiedobjects,
			'verifiedObjects'
		)
	};
}

function sumObjectTypeCounts(
	objectTypes: readonly HistoryArchiveObjectTypeSummaryV1[]
): HistoryArchiveObjectStatusCountsV1 {
	return objectTypes.reduce(
		(totals, row) => ({
			activeObjects: totals.activeObjects + row.activeObjects,
			failedObjects: totals.failedObjects + row.failedObjects,
			pendingObjects: totals.pendingObjects + row.pendingObjects,
			totalObjects: totals.totalObjects + row.totalObjects,
			verifiedObjects: totals.verifiedObjects + row.verifiedObjects
		}),
		{
			activeObjects: 0,
			failedObjects: 0,
			pendingObjects: 0,
			totalObjects: 0,
			verifiedObjects: 0
		}
	);
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

const archiveFilterSql =
	'($1::text is null or "archiveUrlIdentity" = $1::text)';

const objectTypeSummarySql = `
	select
		"objectType" as "objectType",
		count(*) as "totalObjects",
		count(*) filter (where status = 'pending') as "pendingObjects",
		count(*) filter (where status = 'scanning') as "activeObjects",
		count(*) filter (where status = 'verified') as "verifiedObjects",
		count(*) filter (where status = 'failed') as "failedObjects"
	from history_archive_object_queue
	where ${archiveFilterSql}
	group by "objectType"
	order by min("objectOrder") asc, "objectType" asc
`;

const bucketCoverageSql = `
	select
		count(*) as "totalObjects",
		count(*) filter (where status = 'pending') as "pendingObjects",
		count(*) filter (where status = 'scanning') as "activeObjects",
		count(*) filter (where status = 'verified') as "verifiedObjects",
		count(*) filter (where status = 'failed') as "failedObjects",
		count(distinct "bucketHash") as "uniqueBucketHashes"
	from history_archive_object_queue
	where ${archiveFilterSql}
		and "objectType" = 'bucket'
`;
