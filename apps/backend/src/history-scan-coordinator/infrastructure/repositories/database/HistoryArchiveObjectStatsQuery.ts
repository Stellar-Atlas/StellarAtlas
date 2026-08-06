import type { EntityManager } from 'typeorm';
import type { HistoryArchiveObjectQueueStats } from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveObjectRepository.js';
import {
	getObjectTypeSummariesFromRollup,
	requireCompleteObjectTypeSummary
} from './HistoryArchiveObjectTypeSummaryReadQuery.js';

export async function getHistoryArchiveObjectStats(
	manager: EntityManager,
	archiveUrlIdentity?: string
): Promise<HistoryArchiveObjectQueueStats> {
	await requireCompleteObjectTypeSummary(manager);
	const summaries = await getObjectTypeSummariesFromRollup(
		manager,
		archiveUrlIdentity ?? null
	);

	return summaries.reduce<HistoryArchiveObjectQueueStats>(
		(total, summary) => ({
			activeObjects: total.activeObjects + summary.activeObjects,
			failedObjects: total.failedObjects + summary.failedObjects,
			pendingObjects: total.pendingObjects + summary.pendingObjects,
			verifiedObjects: total.verifiedObjects + summary.verifiedObjects
		}),
		{
			activeObjects: 0,
			failedObjects: 0,
			pendingObjects: 0,
			verifiedObjects: 0
		}
	);
}
