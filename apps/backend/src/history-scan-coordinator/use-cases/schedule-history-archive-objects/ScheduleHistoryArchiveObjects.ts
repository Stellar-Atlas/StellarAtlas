import 'reflect-metadata';
import { inject, injectable } from 'inversify';
import { err, ok, Result } from 'neverthrow';
import type { Logger } from 'logger';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';
import {
	buildHistoryArchiveObjectsFromState,
	buildRootHistoryArchiveObject
} from '../../domain/history-archive-object/HistoryArchiveObjectBuilder.js';
import type { HistoryArchiveObjectRepository } from '../../domain/history-archive-object/HistoryArchiveObjectRepository.js';
import type { HistoryArchiveStateRepository } from '../../domain/history-archive-state/HistoryArchiveStateRepository.js';
import { TYPES } from '../../infrastructure/di/di-types.js';

export interface ScheduleHistoryArchiveObjectsResult {
	readonly discoveredArchiveUrlCount: number;
	readonly duplicateSuppressedArchiveScanJobCount: number;
	readonly scheduledArchiveScanJobCount: number;
	readonly schedulerErrorCount: number;
}

@injectable()
export class ScheduleHistoryArchiveObjects {
	constructor(
		@inject(TYPES.HistoryArchiveObjectRepository)
		private readonly objectRepository: HistoryArchiveObjectRepository,
		@inject(TYPES.HistoryArchiveStateRepository)
		private readonly stateRepository: HistoryArchiveStateRepository,
		@inject('Logger') private readonly logger: Logger
	) {}

	async execute(
		historyArchiveUrls: readonly string[]
	): Promise<Result<ScheduleHistoryArchiveObjectsResult, Error>> {
		try {
			const rootObjects = historyArchiveUrls
				.map(buildRootHistoryArchiveObject)
				.filter((object) => object !== null);
			const states = await this.stateRepository.findAvailable(5000);
			const stateObjects = states.flatMap(buildHistoryArchiveObjectsFromState);
			const objects = [...rootObjects, ...stateObjects];
			const scheduledCount = await this.objectRepository.saveObjects(objects);

			this.logger.info('Scheduled history archive object checks', {
				app: 'history-scan-coordinator',
				discoveredArchiveUrlCount: historyArchiveUrls.length,
				scheduledCount
			});

			return ok({
				discoveredArchiveUrlCount: historyArchiveUrls.length,
				duplicateSuppressedArchiveScanJobCount: Math.max(
					0,
					objects.length - scheduledCount
				),
				scheduledArchiveScanJobCount: scheduledCount,
				schedulerErrorCount: 0
			});
		} catch (e) {
			const error = mapUnknownToError(e);
			this.logger.error('Failed to schedule history archive objects', {
				app: 'history-scan-coordinator',
				errorMessage: error.message
			});
			return err(error);
		}
	}
}
