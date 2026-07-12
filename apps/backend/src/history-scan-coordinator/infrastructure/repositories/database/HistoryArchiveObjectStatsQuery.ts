import type { EntityManager } from 'typeorm';
import type { HistoryArchiveObjectStatus } from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveObject.js';
import type { HistoryArchiveObjectQueueStats } from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveObjectRepository.js';
import { requireNumber, type NumericValue } from './ScanJobRowMapper.js';

type CountRow = {
	readonly count?: NumericValue;
};

export async function getHistoryArchiveObjectStats(
	manager: EntityManager,
	archiveUrlIdentity?: string
): Promise<HistoryArchiveObjectQueueStats> {
	const [pendingObjects, activeObjects, verifiedObjects, failedObjects] =
		await Promise.all([
			countByStatus(manager, 'pending', archiveUrlIdentity),
			countByStatus(manager, 'scanning', archiveUrlIdentity),
			countByStatus(manager, 'verified', archiveUrlIdentity),
			countByStatus(manager, 'failed', archiveUrlIdentity)
		]);

	return {
		activeObjects,
		failedObjects,
		pendingObjects,
		verifiedObjects
	};
}

async function countByStatus(
	manager: EntityManager,
	status: HistoryArchiveObjectStatus,
	archiveUrlIdentity?: string
): Promise<number> {
	const rows = (await manager.query(
		`
			select count(*)::int as count
				from history_archive_object_queue
				where status = $1
					and (
						$1::text <> 'pending'
						or (
							"executionDisposition" = 'executable'
							and "dependencyReady" = true
						)
					)
				and (
					$2::text is null
					or "archiveUrlIdentity" = $2::text
				)
		`,
		[status, archiveUrlIdentity ?? null]
	)) as readonly CountRow[];

	return requireNumber(rows[0]?.count, `historyArchiveObject.${status}`);
}
