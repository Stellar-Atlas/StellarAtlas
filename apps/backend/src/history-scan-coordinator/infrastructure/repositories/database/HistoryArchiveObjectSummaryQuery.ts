import type { EntityManager } from 'typeorm';
import type {
	HistoryArchiveBucketCoverageV1,
	HistoryArchiveCheckpointCoverageV1,
	HistoryArchiveObjectStatusCountsV1,
	HistoryArchiveObjectSummaryV1,
	HistoryArchiveObjectTypeSummaryV1,
	HistoryArchiveObjectTypeV1
} from 'shared';
import { requireNumber, type NumericValue } from './ScanJobRowMapper.js';

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

type BucketCoverageRow = Omit<ObjectTypeSummaryRow, 'objectType' | 'objecttype'> & {
	readonly uniqueBucketHashes?: NumericValue;
	readonly uniquebuckethashes?: NumericValue;
};

type CheckpointCoverageRow = {
	readonly activeArchiveCheckpoints?: NumericValue;
	readonly activearchivecheckpoints?: NumericValue;
	readonly archiveRootsWithState?: NumericValue;
	readonly archiverootswithstate?: NumericValue;
	readonly completeArchiveCheckpoints?: NumericValue;
	readonly completearchivecheckpoints?: NumericValue;
	readonly discoveryCompleteArchiveRoots?: NumericValue;
	readonly discoverycompletearchiveroots?: NumericValue;
	readonly expectedArchiveCheckpoints?: NumericValue;
	readonly expectedarchivecheckpoints?: NumericValue;
	readonly failedArchiveCheckpoints?: NumericValue;
	readonly failedarchivecheckpoints?: NumericValue;
	readonly latestCheckpointLedger?: NumericValue | null;
	readonly latestcheckpointledger?: NumericValue | null;
	readonly missingArchiveCheckpoints?: NumericValue;
	readonly missingarchivecheckpoints?: NumericValue;
	readonly oldestCheckpointLedger?: NumericValue | null;
	readonly oldestcheckpointledger?: NumericValue | null;
	readonly partialArchiveCheckpoints?: NumericValue;
	readonly partialarchivecheckpoints?: NumericValue;
	readonly totalArchiveCheckpoints?: NumericValue;
	readonly totalarchivecheckpoints?: NumericValue;
};

export async function getHistoryArchiveObjectSummary(
	manager: EntityManager,
	options: SummaryOptions = {}
): Promise<HistoryArchiveObjectSummaryV1> {
	const archiveUrlIdentity = options.archiveUrlIdentity ?? null;
	const [objectTypes, buckets, checkpoints] = await Promise.all([
		getObjectTypeSummaries(manager, archiveUrlIdentity),
		getBucketCoverage(manager, archiveUrlIdentity),
		getCheckpointCoverage(manager, archiveUrlIdentity)
	]);
	const totals = sumObjectTypeCounts(objectTypes);

	return {
		...totals,
		archiveUrl: options.archiveUrl ?? null,
		archiveUrlIdentity,
		buckets,
		checkpoints,
		generatedAt: (options.generatedAt ?? new Date()).toISOString(),
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

async function getCheckpointCoverage(
	manager: EntityManager,
	archiveUrlIdentity: string | null
): Promise<HistoryArchiveCheckpointCoverageV1> {
	const [row] = (await manager.query(checkpointCoverageSql, [
		archiveUrlIdentity
	])) as readonly CheckpointCoverageRow[];

	return {
		activeArchiveCheckpoints: requireNumber(
			row?.activeArchiveCheckpoints ?? row?.activearchivecheckpoints,
			'activeArchiveCheckpoints'
		),
		archiveRootsWithState: requireNumber(
			row?.archiveRootsWithState ?? row?.archiverootswithstate,
			'archiveRootsWithState'
		),
		completeArchiveCheckpoints: requireNumber(
			row?.completeArchiveCheckpoints ?? row?.completearchivecheckpoints,
			'completeArchiveCheckpoints'
		),
		discoveryCompleteArchiveRoots: requireNumber(
			row?.discoveryCompleteArchiveRoots ??
				row?.discoverycompletearchiveroots,
			'discoveryCompleteArchiveRoots'
		),
		expectedArchiveCheckpoints: requireNumber(
			row?.expectedArchiveCheckpoints ?? row?.expectedarchivecheckpoints,
			'expectedArchiveCheckpoints'
		),
		failedArchiveCheckpoints: requireNumber(
			row?.failedArchiveCheckpoints ?? row?.failedarchivecheckpoints,
			'failedArchiveCheckpoints'
		),
		latestCheckpointLedger: toNullableNumber(
			row?.latestCheckpointLedger ?? row?.latestcheckpointledger
		),
		missingArchiveCheckpoints: requireNumber(
			row?.missingArchiveCheckpoints ?? row?.missingarchivecheckpoints,
			'missingArchiveCheckpoints'
		),
		oldestCheckpointLedger: toNullableNumber(
			row?.oldestCheckpointLedger ?? row?.oldestcheckpointledger
		),
		partialArchiveCheckpoints: requireNumber(
			row?.partialArchiveCheckpoints ?? row?.partialarchivecheckpoints,
			'partialArchiveCheckpoints'
		),
		totalArchiveCheckpoints: requireNumber(
			row?.totalArchiveCheckpoints ?? row?.totalarchivecheckpoints,
			'totalArchiveCheckpoints'
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

function requireObjectType(value: string | undefined): HistoryArchiveObjectTypeV1 {
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

function toNullableNumber(value: NumericValue | null | undefined): number | null {
	if (value === null || value === undefined) return null;
	return requireNumber(value, 'checkpointLedger');
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

const checkpointCoverageSql = `
	with root_state as (
		select
			"archiveUrlIdentity",
			floor((greatest("currentLedger", 63) + 1)::numeric / 64)::integer
				as "expectedCheckpointCount"
		from history_archive_state_snapshot
		where ${archiveFilterSql}
			and status = 'available'
			and "currentLedger" is not null
			and "currentLedger" >= 0
	),
	checkpoint_rollup as (
		select
			"archiveUrlIdentity",
			"checkpointLedger",
			bool_or(status = 'failed') as has_failed,
			bool_or(status = 'scanning') as has_active,
			bool_or("objectType" = 'scp') as expects_scp,
			bool_or("objectType" = 'checkpoint-state' and status = 'verified')
				as has_checkpoint_state,
			bool_or("objectType" = 'ledger' and status = 'verified') as has_ledger,
			bool_or("objectType" = 'transactions' and status = 'verified')
				as has_transactions,
			bool_or("objectType" = 'results' and status = 'verified') as has_results,
			bool_or("objectType" = 'scp' and status = 'verified') as has_scp
		from history_archive_object_queue
		where ${archiveFilterSql}
			and "checkpointLedger" is not null
		group by "archiveUrlIdentity", "checkpointLedger"
	),
	root_coverage as (
		select
			root_state."archiveUrlIdentity",
			root_state."expectedCheckpointCount",
			count(distinct checkpoint_rollup."checkpointLedger")
				as "scheduledCheckpointCount",
			min(checkpoint_rollup."checkpointLedger") as "oldestCheckpointLedger"
		from root_state
		left join checkpoint_rollup
			on checkpoint_rollup."archiveUrlIdentity" =
				root_state."archiveUrlIdentity"
		group by
			root_state."archiveUrlIdentity",
			root_state."expectedCheckpointCount"
	),
	classified as (
		select
			"checkpointLedger",
			has_failed,
			has_active,
			(
				not has_failed
				and has_checkpoint_state
				and has_ledger
				and has_transactions
				and has_results
				and (not expects_scp or has_scp)
			) as is_complete
		from checkpoint_rollup
	)
	select
		count(*) as "totalArchiveCheckpoints",
		count(*) filter (where has_active) as "activeArchiveCheckpoints",
		count(*) filter (where has_failed) as "failedArchiveCheckpoints",
		count(*) filter (where is_complete) as "completeArchiveCheckpoints",
		count(*) filter (where not is_complete and not has_failed)
			as "partialArchiveCheckpoints",
		min("checkpointLedger") as "oldestCheckpointLedger",
		max("checkpointLedger") as "latestCheckpointLedger",
		coalesce((select count(*) from root_coverage), 0)
			as "archiveRootsWithState",
		coalesce(
			(select sum("expectedCheckpointCount") from root_coverage),
			0
		) as "expectedArchiveCheckpoints",
		coalesce(
			(
				select sum(
					greatest(
						"expectedCheckpointCount" - "scheduledCheckpointCount",
						0
					)
				)
				from root_coverage
			),
			0
		) as "missingArchiveCheckpoints",
		coalesce(
			(
				select count(*)
				from root_coverage
				where "expectedCheckpointCount" > 0
					and "scheduledCheckpointCount" >= "expectedCheckpointCount"
					and "oldestCheckpointLedger" <= 63
			),
			0
		) as "discoveryCompleteArchiveRoots"
	from classified
`;
