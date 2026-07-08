import type { EntityManager } from 'typeorm';
import type {
	HistoryArchiveBucketCoverageV1,
	HistoryArchiveObjectStatusCountsV1,
	HistoryArchiveObjectSummaryV1,
	HistoryArchiveSourceSummaryV1,
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
	readonly status?: string;
	readonly objectCount?: NumericValue;
	readonly objectcount?: NumericValue;
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

type SourceSummaryRow = ObjectTypeSummaryRow & {
	readonly archiveUrl?: string;
	readonly archiveurl?: string;
	readonly archiveUrlIdentity?: string;
	readonly archiveurlidentity?: string;
	readonly currentLedger?: NumericValue | null;
	readonly currentledger?: NumericValue | null;
	readonly latestCheckpointLedger?: NumericValue | null;
	readonly latestcheckpointledger?: NumericValue | null;
	readonly latestDiscoveredCheckpointLedger?: NumericValue | null;
	readonly latestdiscoveredcheckpointledger?: NumericValue | null;
	readonly objectCompleteCheckpoints?: NumericValue;
	readonly objectcompletecheckpoints?: NumericValue;
	readonly observedAt?: Date | string;
	readonly observedat?: Date | string;
	readonly rootObjectStatus?: string | null;
	readonly rootobjectstatus?: string | null;
	readonly source?: string;
	readonly stateStatus?: string;
	readonly statestatus?: string;
	readonly stateUrl?: string;
	readonly stateurl?: string;
	readonly verifiedCheckpoints?: NumericValue;
	readonly verifiedcheckpoints?: NumericValue;
};

export async function getHistoryArchiveObjectSummary(
	manager: EntityManager,
	options: SummaryOptions = {}
): Promise<HistoryArchiveObjectSummaryV1> {
	const archiveUrlIdentity = options.archiveUrlIdentity ?? null;
	const [objectTypes, buckets, checkpoints, hostThrottles, sources] =
		await Promise.all([
		getObjectTypeSummaries(manager, archiveUrlIdentity),
		getBucketCoverage(manager, archiveUrlIdentity),
		getCheckpointCoverage(manager, archiveUrlIdentity),
			getHistoryArchiveObjectHostThrottles(manager, archiveUrlIdentity),
			getSourceSummaries(manager, archiveUrlIdentity)
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
		scope: archiveUrlIdentity === null ? 'global' : 'archive',
		sources
	};
}

async function getSourceSummaries(
	manager: EntityManager,
	archiveUrlIdentity: string | null
): Promise<readonly HistoryArchiveSourceSummaryV1[]> {
	const rows = (await manager.query(sourceSummarySql, [
		archiveUrlIdentity
	])) as readonly SourceSummaryRow[];

	return rows.map(mapSourceSummaryRow);
}

async function getObjectTypeSummaries(
	manager: EntityManager,
	archiveUrlIdentity: string | null
): Promise<readonly HistoryArchiveObjectTypeSummaryV1[]> {
	const rows = (await manager.query(
		archiveUrlIdentity === null
			? objectTypeStatusSummaryGlobalSql
			: objectTypeStatusSummaryArchiveSql,
		archiveUrlIdentity === null ? [] : [archiveUrlIdentity]
	)) as readonly ObjectTypeSummaryRow[];

	return mapObjectTypeStatusRows(rows);
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

function mapObjectTypeStatusRows(
	rows: readonly ObjectTypeSummaryRow[]
): readonly HistoryArchiveObjectTypeSummaryV1[] {
	const summaries = new Map<
		HistoryArchiveObjectTypeV1,
		HistoryArchiveObjectTypeSummaryV1
	>();

	for (const row of rows) {
		const objectType = requireObjectType(row.objectType ?? row.objecttype);
		const objectCount = requireNumber(
			row.objectCount ?? row.objectcount,
			'objectCount'
		);
		const existing =
			summaries.get(objectType) ?? createEmptyObjectTypeSummary(objectType);
		const next = addStatusCount(existing, row.status, objectCount);
		summaries.set(objectType, next);
	}

	return Array.from(summaries.values()).sort(
		(left, right) =>
			getObjectTypeOrder(left.objectType) - getObjectTypeOrder(right.objectType)
	);
}

function createEmptyObjectTypeSummary(
	objectType: HistoryArchiveObjectTypeV1
): HistoryArchiveObjectTypeSummaryV1 {
	return {
		activeObjects: 0,
		failedObjects: 0,
		objectType,
		pendingObjects: 0,
		totalObjects: 0,
		verifiedObjects: 0
	};
}

function addStatusCount(
	summary: HistoryArchiveObjectTypeSummaryV1,
	status: string | undefined,
	objectCount: number
): HistoryArchiveObjectTypeSummaryV1 {
	const next = {
		...summary,
		totalObjects: summary.totalObjects + objectCount
	};
	switch (status) {
		case 'pending':
			return { ...next, pendingObjects: summary.pendingObjects + objectCount };
		case 'scanning':
			return { ...next, activeObjects: summary.activeObjects + objectCount };
		case 'verified':
			return { ...next, verifiedObjects: summary.verifiedObjects + objectCount };
		case 'failed':
			return { ...next, failedObjects: summary.failedObjects + objectCount };
		default:
			return next;
	}
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

function mapSourceSummaryRow(
	row: SourceSummaryRow
): HistoryArchiveSourceSummaryV1 {
	return {
		activeObjects: requireNumber(
			row.activeObjects ?? row.activeobjects,
			'activeObjects'
		),
		archiveUrl: requireString(row.archiveUrl ?? row.archiveurl, 'archiveUrl'),
		archiveUrlIdentity: requireString(
			row.archiveUrlIdentity ?? row.archiveurlidentity,
			'archiveUrlIdentity'
		),
		currentLedger: nullableNumber(row.currentLedger ?? row.currentledger),
		failedObjects: requireNumber(
			row.failedObjects ?? row.failedobjects,
			'failedObjects'
		),
		latestCheckpointLedger: nullableNumber(
			row.latestCheckpointLedger ?? row.latestcheckpointledger
		),
		latestDiscoveredCheckpointLedger: nullableNumber(
			row.latestDiscoveredCheckpointLedger ??
				row.latestdiscoveredcheckpointledger
		),
		objectCompleteCheckpoints: requireNumber(
			row.objectCompleteCheckpoints ?? row.objectcompletecheckpoints,
			'objectCompleteCheckpoints'
		),
		observedAt: formatDateField(row.observedAt ?? row.observedat),
		pendingObjects: requireNumber(
			row.pendingObjects ?? row.pendingobjects,
			'pendingObjects'
		),
		rootObjectStatus: requireNullableObjectStatus(
			row.rootObjectStatus ?? row.rootobjectstatus
		),
		source: requireStateSource(row.source),
		stateStatus: requireStateStatus(row.stateStatus ?? row.statestatus),
		stateUrl: requireString(row.stateUrl ?? row.stateurl, 'stateUrl'),
		totalObjects: requireNumber(
			row.totalObjects ?? row.totalobjects,
			'totalObjects'
		),
		verifiedCheckpoints: requireNumber(
			row.verifiedCheckpoints ?? row.verifiedcheckpoints,
			'verifiedCheckpoints'
		),
		verifiedObjects: requireNumber(
			row.verifiedObjects ?? row.verifiedobjects,
			'verifiedObjects'
		)
	};
}

function requireString(value: string | undefined, field: string): string {
	if (typeof value === 'string' && value.length > 0) return value;
	throw new Error(`Archive object source summary row is missing ${field}`);
}

function nullableNumber(value: NumericValue | null | undefined): number | null {
	if (value === null || value === undefined) return null;
	return requireNumber(value, 'nullableNumber');
}

function formatDateField(value: Date | string | undefined): string {
	if (value instanceof Date) return value.toISOString();
	if (typeof value === 'string') return new Date(value).toISOString();
	throw new Error('Archive object source summary row is missing observedAt');
}

function requireNullableObjectStatus(
	value: string | null | undefined
): HistoryArchiveSourceSummaryV1['rootObjectStatus'] {
	if (value === null || value === undefined) return null;
	if (
		value === 'pending' ||
		value === 'scanning' ||
		value === 'verified' ||
		value === 'failed'
	) {
		return value;
	}
	throw new Error('Archive object source summary row has invalid root status');
}

function requireStateSource(
	value: string | undefined
): HistoryArchiveSourceSummaryV1['source'] {
	if (
		value === 'backfill' ||
		value === 'history-scanner' ||
		value === 'network-scan'
	) {
		return value;
	}
	throw new Error('Archive object source summary row has invalid source');
}

function requireStateStatus(
	value: string | undefined
): HistoryArchiveSourceSummaryV1['stateStatus'] {
	if (value === 'available' || value === 'invalid' || value === 'unreachable') {
		return value;
	}
	throw new Error('Archive object source summary row has invalid state status');
}

function getObjectTypeOrder(objectType: HistoryArchiveObjectTypeV1): number {
	switch (objectType) {
		case 'history-archive-state':
			return 0;
		case 'checkpoint-state':
			return 1;
		case 'ledger':
			return 2;
		case 'transactions':
			return 3;
		case 'results':
			return 4;
		case 'scp':
			return 5;
		case 'bucket':
			return 6;
	}
}

const archiveFilterSql =
	'($1::text is null or "archiveUrlIdentity" = $1::text)';

const objectTypeStatusSummarySelectSql = `
	select
		"objectType" as "objectType",
		status,
		count(*) as "objectCount"
	from history_archive_object_queue
`;

const objectTypeStatusSummaryGlobalSql = `
	${objectTypeStatusSummarySelectSql}
	group by "objectType", status
	order by "objectType" asc, status asc
`;

const objectTypeStatusSummaryArchiveSql = `
	${objectTypeStatusSummarySelectSql}
	where "archiveUrlIdentity" = $1::text
	group by "objectType", status
	order by "objectType" asc, status asc
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

const sourceSummarySql = `
	with object_counts as (
		select
			"archiveUrlIdentity",
			count(*) as "totalObjects",
			count(*) filter (where status = 'pending') as "pendingObjects",
			count(*) filter (where status = 'scanning') as "activeObjects",
			count(*) filter (where status = 'verified') as "verifiedObjects",
			count(*) filter (where status = 'failed') as "failedObjects"
		from history_archive_object_queue
		where ${archiveFilterSql}
		group by "archiveUrlIdentity"
	),
	root_object as (
		select distinct on ("archiveUrlIdentity")
			"archiveUrlIdentity",
			status as "rootObjectStatus"
		from history_archive_object_queue
		where ${archiveFilterSql}
			and "objectType" = 'history-archive-state'
		order by "archiveUrlIdentity", "updatedAt" desc
	),
	checkpoint_bounds as (
		select
			"archiveUrlIdentity",
			max("checkpointLedger") as "latestDiscoveredCheckpointLedger",
			count(*) filter (where "requiredObjectsComplete")
				as "objectCompleteCheckpoints",
			count(*) filter (where status = 'verified') as "verifiedCheckpoints"
		from history_archive_checkpoint_proof
		where ${archiveFilterSql}
		group by "archiveUrlIdentity"
	)
	select
		state."archiveUrl",
		state."archiveUrlIdentity",
		state."stateUrl",
		state.status as "stateStatus",
		state."observedAt",
		state.source,
		state."currentLedger",
		case
			when state."currentLedger" is null then null
			else (
				floor((greatest(state."currentLedger", 63) + 1)::numeric / 64)::integer
					* 64
			) - 1
		end as "latestCheckpointLedger",
		checkpoint_bounds."latestDiscoveredCheckpointLedger",
		coalesce(checkpoint_bounds."objectCompleteCheckpoints", 0)
			as "objectCompleteCheckpoints",
		coalesce(checkpoint_bounds."verifiedCheckpoints", 0)
			as "verifiedCheckpoints",
		root_object."rootObjectStatus",
		coalesce(object_counts."totalObjects", 0) as "totalObjects",
		coalesce(object_counts."pendingObjects", 0) as "pendingObjects",
		coalesce(object_counts."activeObjects", 0) as "activeObjects",
		coalesce(object_counts."verifiedObjects", 0) as "verifiedObjects",
		coalesce(object_counts."failedObjects", 0) as "failedObjects"
	from history_archive_state_snapshot state
	left join object_counts
		on object_counts."archiveUrlIdentity" = state."archiveUrlIdentity"
	left join root_object
		on root_object."archiveUrlIdentity" = state."archiveUrlIdentity"
	left join checkpoint_bounds
		on checkpoint_bounds."archiveUrlIdentity" = state."archiveUrlIdentity"
	where ($1::text is null or state."archiveUrlIdentity" = $1::text)
	order by
		state.status asc,
		coalesce(state."currentLedger", -1) desc,
		state."archiveUrlIdentity" asc
`;
