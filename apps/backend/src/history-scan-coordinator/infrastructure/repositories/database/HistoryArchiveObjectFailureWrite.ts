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
import { lockHistoryArchiveObjectRootTransition } from './HistoryArchiveRootTransitionLock.js';
import { requeueFailedHistoryArchiveBrokerReadyRow } from './HistoryArchiveObjectReadyQueue.js';

export async function markHistoryArchiveObjectFailed(
	repository: Repository<HistoryArchiveObject>,
	remoteId: string,
	failure: HistoryArchiveObjectFailure,
	hostFailure?: HistoryArchiveObjectHostFailure
): Promise<boolean> {
	if (failure.scheduler === 'broker' && failure.executionId === undefined)
		return false;
	return await repository.manager.transaction(async (manager) => {
		await lockHistoryArchiveObjectRootTransition(manager, remoteId);
		const update = {
			...createFailedUpdate(failure),
			...(failure.scheduler === 'broker'
				? { attempts: failure.claimAttempt }
				: {})
		};
		const query = manager
			.createQueryBuilder()
			.update(HistoryArchiveObject)
			.set(update)
			.where('"remoteId" = :remoteId', { remoteId });
		if (failure.scheduler === 'broker') {
			query.andWhere(
				`exists (
					select 1 from "history_archive_object_ready" ready
					where ready."objectRemoteId" = :remoteId
						and ready."dispatchToken" = :executionId
						and ready."claimAttempt" = :claimAttempt
				)
				and (attempts < :claimAttempt
				  or (attempts = :claimAttempt and status <> :failedStatus))`,
				{
					claimAttempt: failure.claimAttempt,
					executionId: failure.executionId,
					failedStatus: 'failed'
				}
			);
		} else {
			query
				.andWhere('status = :status', { status: 'scanning' })
				.andWhere('attempts = :claimAttempt', {
					claimAttempt: failure.claimAttempt
				});
		}
		const result = await query.execute();
		if ((result.affected ?? 0) === 0) return false;
		if (failure.scheduler !== 'broker') {
			await manager.query(
				`update "history_archive_object_claim_slot"
				 set "objectRemoteId" = null, "claimAttempt" = null,
				     "claimedAt" = null, "updatedAt" = now()
				 where "objectRemoteId" = $1::uuid and "claimAttempt" = $2`,
				[remoteId, failure.claimAttempt]
			);
		}

		if (hostFailure !== undefined) {
			await manager.query(historyArchiveObjectHostFailureUpsertSql, [
				...toHistoryArchiveObjectHostFailureSqlParams(hostFailure)
			]);
		}
		if (failure.scheduler === 'broker') {
			await requeueFailedHistoryArchiveBrokerReadyRow(
				manager,
				remoteId,
				failure.executionId!,
				failure.claimAttempt,
				failure.nextAttemptAt ?? null
			);
		}

		return true;
	});
}
