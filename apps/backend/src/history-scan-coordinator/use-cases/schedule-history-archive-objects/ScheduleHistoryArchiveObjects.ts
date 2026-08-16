import 'reflect-metadata';
import { inject, injectable } from 'inversify';
import { err, ok, Result } from 'neverthrow';
import type { Logger } from 'logger';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';
import { buildRootHistoryArchiveObject } from '../../domain/history-archive-object/HistoryArchiveObjectBuilder.js';
import type { HistoryArchiveObjectRepository } from '../../domain/history-archive-object/HistoryArchiveObjectRepository.js';
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
		@inject('Logger') private readonly logger: Logger
	) {}

	async execute(
		historyArchiveUrls: readonly string[]
	): Promise<Result<ScheduleHistoryArchiveObjectsResult, Error>> {
		try {
			const rootObjects = historyArchiveUrls
				.map(buildRootHistoryArchiveObject)
				.filter((object) => object !== null);
			const scheduledCount =
				await this.objectRepository.planObjects(rootObjects);
			const promotion = await this.objectRepository.promotePlannedObjects();

			this.logger.info('Scheduled history archive object checks', {
				app: 'history-scan-coordinator',
				discoveredArchiveUrlCount: historyArchiveUrls.length,
				outstandingObjects: promotion.outstandingObjects,
				promotedObjects: promotion.promotedObjects,
				schedulingScope: 'discovered-roots',
				watermark: promotion.watermark,
				scheduledCount
			});

			return ok({
				discoveredArchiveUrlCount: historyArchiveUrls.length,
				duplicateSuppressedArchiveScanJobCount: Math.max(
					0,
					rootObjects.length - scheduledCount
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
