import type { EntityManager } from 'typeorm';
import { HistoryArchiveObject } from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveObject.js';
import {
	getHistoryArchiveStateRefreshBefore,
	getRefreshableHistoryArchiveStateArchiveIdentities
} from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveObjectRefreshPolicy.js';

export async function markCapturedHistoryArchiveStateObjectsVerified(
	manager: EntityManager,
	objects: readonly HistoryArchiveObject[]
): Promise<void> {
	const archiveUrlIdentities = Array.from(
		new Set(
			objects
				.filter(
					(object) =>
						object.objectType === 'history-archive-state' &&
						object.objectKey === 'root' &&
						object.status === 'verified'
				)
				.map((object) => object.archiveUrlIdentity)
		)
	);
	if (archiveUrlIdentities.length === 0) return;

	await manager
		.createQueryBuilder()
		.update(HistoryArchiveObject)
		.set({
			bytesDownloaded: null,
			claimedAt: null,
			claimedByCommunityScannerId: null,
			errorMessage: null,
			errorType: null,
			failureChannel: null,
			httpStatus: null,
			nextAttemptAt: null,
			refreshAfter: () => 'now() + make_interval(mins => 5)',
			status: 'verified',
			updatedAt: () => 'now()',
			verifiedAt: () => 'now()',
			workerStage: 'captured_history_archive_state'
		})
		.where('"archiveUrlIdentity" IN (:...archiveUrlIdentities)', {
			archiveUrlIdentities
		})
		.andWhere('"objectType" = :objectType', {
			objectType: 'history-archive-state'
		})
		.andWhere('"objectKey" = :objectKey', { objectKey: 'root' })
		.andWhere('status != :scanningStatus', {
			scanningStatus: 'scanning'
		})
		.execute();
}

export async function requeueStaleHistoryArchiveStateObjects(
	manager: EntityManager,
	objects: readonly HistoryArchiveObject[]
): Promise<number> {
	const archiveUrlIdentities =
		getRefreshableHistoryArchiveStateArchiveIdentities(objects);
	if (archiveUrlIdentities.length === 0) return 0;

	const result = await manager
		.createQueryBuilder()
		.update(HistoryArchiveObject)
		.set({
			bytesDownloaded: null,
			claimedAt: null,
			claimedByCommunityScannerId: null,
			errorMessage: null,
			errorType: null,
			failureChannel: null,
			httpStatus: null,
			nextAttemptAt: null,
			status: 'pending',
			updatedAt: () => 'now()',
			verifiedAt: null,
			workerStage: null
		})
		.where('"archiveUrlIdentity" IN (:...archiveUrlIdentities)', {
			archiveUrlIdentities
		})
		.andWhere('"objectType" = :objectType', {
			objectType: 'history-archive-state'
		})
		.andWhere('"objectKey" = :objectKey', { objectKey: 'root' })
		.andWhere('status = :status', { status: 'verified' })
		.andWhere(
			`(
				"refreshAfter" <= now()
				or (
					"refreshAfter" is null
					and "updatedAt" < :before
				)
			)`,
			{ before: getHistoryArchiveStateRefreshBefore() }
		)
		.execute();

	return result.affected ?? 0;
}
