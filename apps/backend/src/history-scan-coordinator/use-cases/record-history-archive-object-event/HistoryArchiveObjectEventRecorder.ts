import 'reflect-metadata';
import { inject, injectable } from 'inversify';
import type { Logger } from 'logger';
import type { HistoryArchiveObject } from '../../domain/history-archive-object/HistoryArchiveObject.js';
import type { HistoryArchiveObjectEventOptions } from '../../domain/history-archive-object/HistoryArchiveObjectEventRepository.js';
import type { HistoryArchiveObjectEventRepository } from '../../domain/history-archive-object/HistoryArchiveObjectEventRepository.js';
import { TYPES } from '../../infrastructure/di/di-types.js';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';

@injectable()
export class HistoryArchiveObjectEventRecorder {
	constructor(
		@inject(TYPES.HistoryArchiveObjectEventRepository)
		private readonly eventRepository: HistoryArchiveObjectEventRepository,
		@inject('Logger') private readonly logger: Logger
	) {}

	async record(
		object: HistoryArchiveObject,
		options: HistoryArchiveObjectEventOptions
	): Promise<void> {
		try {
			await this.eventRepository.appendFromObject(object, options);
		} catch (e) {
			const error = mapUnknownToError(e);
			this.logger.error('Failed to persist history archive object event', {
				app: 'history-scan-coordinator',
				errorMessage: error.message,
				eventType: options.eventType,
				objectRemoteId: object.remoteId
			});
		}
	}

	async recordDurably(
		object: HistoryArchiveObject,
		options: HistoryArchiveObjectEventOptions
	): Promise<void> {
		await this.eventRepository.appendFromObjectIdempotently(object, options);
	}
}
