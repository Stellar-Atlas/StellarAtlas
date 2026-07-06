import 'reflect-metadata';
import { inject, injectable } from 'inversify';
import { err, ok, Result } from 'neverthrow';
import type { HistoryArchiveObjectProgressUpdate } from '../../domain/history-archive-object/HistoryArchiveObjectRepository.js';
import type { HistoryArchiveObjectRepository } from '../../domain/history-archive-object/HistoryArchiveObjectRepository.js';
import { TYPES } from '../../infrastructure/di/di-types.js';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';
import { HistoryArchiveObjectEventRecorder } from '../record-history-archive-object-event/HistoryArchiveObjectEventRecorder.js';

@injectable()
export class TouchHistoryArchiveObject {
	constructor(
		@inject(TYPES.HistoryArchiveObjectRepository)
		private readonly objectRepository: HistoryArchiveObjectRepository,
		private readonly eventRecorder: HistoryArchiveObjectEventRecorder
	) {}

	async execute(
		remoteId: string,
		progress?: HistoryArchiveObjectProgressUpdate
	): Promise<Result<boolean, Error>> {
		try {
			const updated = await this.objectRepository.markObjectActive(
				remoteId,
				progress
			);
			if (updated) {
				const object = await this.objectRepository.findByRemoteId(remoteId);
				if (object !== null) {
					await this.eventRecorder.record(object, {
						claimAttempt: progress?.claimAttempt ?? null,
						eventType: 'heartbeat'
					});
				}
			}

			return ok(updated);
		} catch (e) {
			return err(mapUnknownToError(e));
		}
	}
}
