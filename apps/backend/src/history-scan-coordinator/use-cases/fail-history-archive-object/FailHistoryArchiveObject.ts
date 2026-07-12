import 'reflect-metadata';
import { inject, injectable } from 'inversify';
import { err, ok, Result } from 'neverthrow';
import type { HistoryArchiveCheckpointProofRepository } from '../../domain/history-archive-checkpoint-proof/HistoryArchiveCheckpointProofRepository.js';
import type { HistoryArchiveObject } from '../../domain/history-archive-object/HistoryArchiveObject.js';
import type { HistoryArchiveObjectFailure } from '../../domain/history-archive-object/HistoryArchiveObjectRepository.js';
import type { HistoryArchiveObjectRepository } from '../../domain/history-archive-object/HistoryArchiveObjectRepository.js';
import {
	getHistoryArchiveObjectRetryPolicy,
	shouldThrottleHistoryArchiveObjectHost
} from '../../domain/history-archive-object/HistoryArchiveObjectRetryPolicy.js';
import { TYPES } from '../../infrastructure/di/di-types.js';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';
import { HistoryArchiveObjectEventRecorder } from '../record-history-archive-object-event/HistoryArchiveObjectEventRecorder.js';

@injectable()
export class FailHistoryArchiveObject {
	constructor(
		@inject(TYPES.HistoryArchiveObjectRepository)
		private readonly objectRepository: HistoryArchiveObjectRepository,
		private readonly eventRecorder: HistoryArchiveObjectEventRecorder,
		@inject(TYPES.HistoryArchiveCheckpointProofRepository)
		private readonly checkpointProofRepository: HistoryArchiveCheckpointProofRepository
	) {}

	async execute(
		remoteId: string,
		failure: HistoryArchiveObjectFailure
	): Promise<Result<boolean, Error>> {
		try {
			const object = await this.objectRepository.findByRemoteId(remoteId);
			if (object === null) return ok(false);

			const now = new Date();
			const retryPolicy = getHistoryArchiveObjectRetryPolicy({
				currentRetryCount: Math.max(0, object.attempts - 1),
				errorType: failure.errorType,
				failureChannel: failure.failureChannel,
				httpStatus: failure.httpStatus,
				now,
				objectType: object.objectType,
				retryAfterSeconds: failure.retryAfterSeconds
			});

			const hostFailure =
				failure.failureChannel === 'archive_evidence' &&
				shouldThrottleHistoryArchiveObjectHost({
					errorType: failure.errorType,
					failureClass: retryPolicy.failureClass,
					httpStatus: failure.httpStatus
				})
					? {
							archiveUrlIdentity: object.archiveUrlIdentity,
							blockedUntil: retryPolicy.nextAttemptAt,
							errorType: failure.errorType,
							evidenceClass: retryPolicy.evidenceClass,
							failureClass: retryPolicy.failureClass,
							hostIdentity: object.hostIdentity,
							httpStatus: failure.httpStatus,
							retryAfterUntil: toRetryAfterUntil(failure.retryAfterSeconds, now)
						}
					: undefined;
			const transitioned = await this.objectRepository.markObjectFailed(
				remoteId,
				{
					...failure,
					nextAttemptAt: retryPolicy.nextAttemptAt
				},
				hostFailure
			);
			const failedObject = await this.objectRepository.findByRemoteId(remoteId);
			if (
				failedObject === null ||
				(!transitioned && !isAcceptedFailureReplay(failedObject, failure))
			) {
				return ok(false);
			}

			return ok(true);
		} catch (e) {
			return err(mapUnknownToError(e));
		}
	}

	async reconcilePersisted(object: HistoryArchiveObject): Promise<void> {
		if (object.status !== 'failed') return;
		if (object.transitionEffectsCompletedAt !== null) return;
		const retryPolicy = getHistoryArchiveObjectRetryPolicy({
			currentRetryCount: Math.max(0, object.attempts - 1),
			errorType: object.errorType,
			failureChannel: object.failureChannel ?? 'scanner_issue',
			httpStatus: object.httpStatus,
			now: new Date(),
			objectType: object.objectType
		});
		if (shouldRefreshCheckpointProof(object)) {
			await this.checkpointProofRepository.refreshForObject(object);
		}
		await this.eventRecorder.recordDurably(object, {
			claimAttempt: object.attempts,
			eventType: 'failed',
			evidenceClass: retryPolicy.evidenceClass
		});
		await this.objectRepository.markTransitionEffectsCompleted(
			object.remoteId,
			object.attempts,
			'failed'
		);
	}
}

function toRetryAfterUntil(
	value: number | null | undefined,
	now: Date
): Date | null {
	if (!Number.isSafeInteger(value) || value === undefined || value === null) {
		return null;
	}
	return new Date(now.getTime() + Math.max(0, value) * 1000);
}

function isAcceptedFailureReplay(
	object: {
		readonly attempts: number;
		readonly errorMessage: string | null;
		readonly errorType: string | null;
		readonly failureChannel: string | null;
		readonly httpStatus: number | null;
		readonly status: string;
	},
	failure: HistoryArchiveObjectFailure
): boolean {
	return (
		object.status === 'failed' &&
		object.attempts === failure.claimAttempt &&
		object.errorType === failure.errorType &&
		object.errorMessage === failure.errorMessage &&
		object.failureChannel === failure.failureChannel &&
		object.httpStatus === (failure.httpStatus ?? null)
	);
}

function shouldRefreshCheckpointProof(object: {
	readonly bucketHash: string | null;
	readonly checkpointLedger: number | null;
}): boolean {
	return object.checkpointLedger !== null || object.bucketHash !== null;
}
