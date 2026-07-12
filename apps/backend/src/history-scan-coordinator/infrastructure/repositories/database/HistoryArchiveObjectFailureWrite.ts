import type { Repository } from 'typeorm';
import { HistoryArchiveObject } from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveObject.js';
import type {
	HistoryArchiveObjectFailure,
	HistoryArchiveObjectHostFailure
} from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveObjectRepository.js';
import { createFailedUpdate } from './HistoryArchiveObjectUpdateFactory.js';
import {
	historyArchiveObjectHostFailureUpsertSql,
	toHistoryArchiveObjectHostFailureSqlParams
} from './HistoryArchiveObjectHostThrottleSql.js';

export async function markHistoryArchiveObjectFailed(
	repository: Repository<HistoryArchiveObject>,
	remoteId: string,
	failure: HistoryArchiveObjectFailure,
	hostFailure?: HistoryArchiveObjectHostFailure
): Promise<boolean> {
	return await repository.manager.transaction(async (manager) => {
		const result = await manager
			.createQueryBuilder()
			.update(HistoryArchiveObject)
			.set(createFailedUpdate(failure))
			.where('"remoteId" = :remoteId', { remoteId })
			.andWhere('status = :status', { status: 'scanning' })
			.andWhere('attempts = :claimAttempt', {
				claimAttempt: failure.claimAttempt
			})
			.execute();
		if ((result.affected ?? 0) === 0) return false;
		await manager.query(
			`update "history_archive_object_claim_slot"
			 set "objectRemoteId" = null, "claimedAt" = null, "updatedAt" = now()
			 where "objectRemoteId" = $1::uuid`,
			[remoteId]
		);

		if (hostFailure !== undefined) {
			await manager.query(historyArchiveObjectHostFailureUpsertSql, [
				...toHistoryArchiveObjectHostFailureSqlParams(hostFailure)
			]);
		}

		return true;
	});
}
