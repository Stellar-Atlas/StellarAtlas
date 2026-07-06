import 'reflect-metadata';
import { inject, injectable } from 'inversify';
import { err, ok, Result } from 'neverthrow';
import type { HistoryArchiveObjectFailure } from '../../domain/history-archive-object/HistoryArchiveObjectRepository.js';
import type { HistoryArchiveObjectRepository } from '../../domain/history-archive-object/HistoryArchiveObjectRepository.js';
import { getHistoryArchiveObjectRetryPolicy } from '../../domain/history-archive-object/HistoryArchiveObjectRetryPolicy.js';
import { TYPES } from '../../infrastructure/di/di-types.js';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';

@injectable()
export class FailHistoryArchiveObject {
	constructor(
		@inject(TYPES.HistoryArchiveObjectRepository)
		private readonly objectRepository: HistoryArchiveObjectRepository
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

			return ok(
				await this.objectRepository.markObjectFailed(remoteId, {
					...failure,
					nextAttemptAt: retryPolicy.nextAttemptAt
				})
			);
		} catch (e) {
			return err(mapUnknownToError(e));
		}
	}
}
