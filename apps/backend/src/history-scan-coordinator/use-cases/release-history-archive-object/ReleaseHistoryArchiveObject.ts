import 'reflect-metadata';
import { inject, injectable } from 'inversify';
import { err, ok, Result } from 'neverthrow';
import type { HistoryArchiveObjectRepository } from '../../domain/history-archive-object/HistoryArchiveObjectRepository.js';
import type { HistoryArchiveCheckpointProofRepository } from '../../domain/history-archive-checkpoint-proof/HistoryArchiveCheckpointProofRepository.js';
import { TYPES } from '../../infrastructure/di/di-types.js';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';
import { HistoryArchiveObjectEventRecorder } from '../record-history-archive-object-event/HistoryArchiveObjectEventRecorder.js';

@injectable()
export class ReleaseHistoryArchiveObject {
	constructor(
		@inject(TYPES.HistoryArchiveObjectRepository)
		private readonly objectRepository: HistoryArchiveObjectRepository,
		@inject(TYPES.HistoryArchiveCheckpointProofRepository)
		private readonly checkpointProofRepository: HistoryArchiveCheckpointProofRepository,
		private readonly eventRecorder: HistoryArchiveObjectEventRecorder
	) {}

	async execute(
		remoteId: string,
		claimAttempt: number
	): Promise<Result<boolean, Error>> {
		try {
			const released = await this.objectRepository.releaseObject(
				remoteId,
				claimAttempt
			);
			if (released) {
				const object = await this.objectRepository.findByRemoteId(remoteId);
				if (object !== null) {
					if (object.checkpointLedger !== null || object.bucketHash !== null) {
						await this.checkpointProofRepository.refreshForObject(object);
					}
					await this.eventRecorder.record(object, {
						claimAttempt,
						eventType: 'released'
					});
				}
			}

			return ok(released);
		} catch (e) {
			return err(mapUnknownToError(e));
		}
	}
}
