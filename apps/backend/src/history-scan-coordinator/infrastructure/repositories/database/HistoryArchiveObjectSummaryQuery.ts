import type { EntityManager } from 'typeorm';
import type {
	HistoryArchiveObjectStatusCountsV1,
	HistoryArchiveObjectSummaryV1,
	HistoryArchiveObjectTypeSummaryV1
} from 'shared';
import { getCheckpointCoverage } from './HistoryArchiveObjectCheckpointCoverageQuery.js';
import { getHistoryArchiveObjectHostThrottles } from './HistoryArchiveObjectHostThrottleSummaryQuery.js';
import {
	buildBucketCoverage,
	getExactUniqueBucketHashCount
} from './HistoryArchiveObjectBucketSummaryQuery.js';
import { getSourceSummariesFromRollup } from './HistoryArchiveObjectSourceSummaryQuery.js';
import {
	getObjectTypeSummariesFromRollup,
	requireCompleteObjectTypeSummary
} from './HistoryArchiveObjectTypeSummaryReadQuery.js';

interface SummaryOptions {
	readonly archiveUrl?: string | null;
	readonly archiveUrlIdentity?: string | null;
	readonly generatedAt?: Date;
}

export async function getHistoryArchiveObjectSummary(
	manager: EntityManager,
	options: SummaryOptions = {}
): Promise<HistoryArchiveObjectSummaryV1> {
	const archiveUrlIdentity = options.archiveUrlIdentity ?? null;
	await requireCompleteObjectTypeSummary(manager);

	const [objectTypes, uniqueBucketHashes, checkpoints, hostThrottles, sources] =
		await Promise.all([
			getObjectTypeSummariesFromRollup(manager, archiveUrlIdentity),
			getExactUniqueBucketHashCount(manager, archiveUrlIdentity),
			getCheckpointCoverage(manager, archiveUrlIdentity),
			getHistoryArchiveObjectHostThrottles(manager, archiveUrlIdentity),
			getSourceSummariesFromRollup(manager, archiveUrlIdentity)
		]);

	return {
		...sumObjectTypeCounts(objectTypes),
		archiveUrl: options.archiveUrl ?? null,
		archiveUrlIdentity,
		buckets: buildBucketCoverage(objectTypes, uniqueBucketHashes),
		checkpoints,
		generatedAt: (options.generatedAt ?? new Date()).toISOString(),
		hostThrottles,
		objectTypes,
		scope: archiveUrlIdentity === null ? 'global' : 'archive',
		sources
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
