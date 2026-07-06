import 'reflect-metadata';
import { inject, injectable } from 'inversify';
import { err, ok, Result } from 'neverthrow';
import type { HistoryArchiveObjectFailure } from '../../domain/history-archive-object/HistoryArchiveObjectRepository.js';
import type { HistoryArchiveObjectRepository } from '../../domain/history-archive-object/HistoryArchiveObjectRepository.js';
import { getHistoryArchiveObjectRetryPolicy } from '../../domain/history-archive-object/HistoryArchiveObjectRetryPolicy.js';
import { TYPES } from '../../infrastructure/di/di-types.js';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';
import { HistoryArchiveObjectEventRecorder } from '../record-history-archive-object-event/HistoryArchiveObjectEventRecorder.js';

@injectable()
export class FailHistoryArchiveObject {
	constructor(
		@inject(TYPES.HistoryArchiveObjectRepository)
		private readonly objectRepository: HistoryArchiveObjectRepository,
		private readonly eventRecorder: HistoryArchiveObjectEventRecorder
	) {}

	async execute(
		remoteId: string,
		failure: HistoryArchiveObjectFailure
	): Promise<Result<boolean, Error>> {
		try {
			const object = await this.objectRepository.findByRemoteId(remoteId);
			if (object === null) return ok(false);

			const retryPolicy = getHistoryArchiveObjectRetryPolicy({
				currentRetryCount: Math.max(0, object.attempts - 1),
				errorType: failure.errorType,
				httpStatus: failure.httpStatus,
				now: new Date(),
				objectType: object.objectType
			});

			const updated = await this.objectRepository.markObjectFailed(remoteId, {
				...failure,
				nextAttemptAt: retryPolicy.nextAttemptAt
			});
			if (updated) {
				await this.objectRepository.recordHostFailure({
					archiveUrlIdentity: object.archiveUrlIdentity,
					blockedUntil: retryPolicy.nextAttemptAt,
					errorType: failure.errorType,
					evidenceClass: retryPolicy.evidenceClass,
					failureClass: retryPolicy.failureClass,
					hostIdentity: object.hostIdentity,
					httpStatus: failure.httpStatus
				});
				const failedObject =
					await this.objectRepository.findByRemoteId(remoteId);
				if (failedObject !== null) {
					await this.eventRecorder.record(failedObject, {
						claimAttempt: failure.claimAttempt,
						eventType: 'failed',
						evidenceClass: retryPolicy.evidenceClass
					});
				}
			}

			return ok(updated);
		} catch (e) {
			return err(mapUnknownToError(e));
		}
	}
}
