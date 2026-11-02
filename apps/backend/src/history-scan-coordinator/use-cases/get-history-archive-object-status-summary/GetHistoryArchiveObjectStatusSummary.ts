import 'reflect-metadata';
import { inject, injectable } from 'inversify';
import { err, ok, Result } from 'neverthrow';
import type { HistoryArchiveStatusSummaryV1 } from 'shared';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';
import type { HistoryArchiveObjectRepository } from '../../domain/history-archive-object/HistoryArchiveObjectRepository.js';
import { TYPES } from '../../infrastructure/di/di-types.js';
import { StaleWhileRevalidateCache } from './StaleWhileRevalidateCache.js';

const statusSummaryCache =
	new StaleWhileRevalidateCache<HistoryArchiveStatusSummaryV1>(
		10_000,
		60_000,
		5_000
	);

@injectable()
export class GetHistoryArchiveObjectStatusSummary {
	constructor(
		@inject(TYPES.HistoryArchiveObjectRepository)
		private readonly objectRepository: HistoryArchiveObjectRepository,
		@inject('ExceptionLogger') private readonly exceptionLogger: ExceptionLogger
	) {}

	async execute(): Promise<Result<HistoryArchiveStatusSummaryV1, Error>> {
		try {
			return ok(
				await statusSummaryCache.get(
					() => this.objectRepository.getStatusSummary(),
					(e) => this.exceptionLogger.captureException(mapUnknownToError(e))
				)
			);
		} catch (e) {
			const error = mapUnknownToError(e);
			return err(error);
		}
	}
}
