import 'reflect-metadata';
import { inject, injectable } from 'inversify';
import { err, ok, type Result } from 'neverthrow';
import type { HistoryArchiveWorkerReportDTO } from 'history-scanner-dto';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';
import type { HistoryArchiveWorkerStatusRepository } from '../../domain/history-archive-worker/HistoryArchiveWorkerStatus.js';
import { TYPES } from '../../infrastructure/di/di-types.js';

@injectable()
export class ReportHistoryArchiveWorkerStatus {
	constructor(
		@inject(TYPES.HistoryArchiveWorkerStatusRepository)
		private readonly repository: HistoryArchiveWorkerStatusRepository,
		@inject('ExceptionLogger')
		private readonly exceptionLogger: ExceptionLogger
	) {}

	async execute(
		report: HistoryArchiveWorkerReportDTO
	): Promise<Result<void, Error>> {
		try {
			await this.repository.report(report, new Date());
			return ok(undefined);
		} catch (error) {
			const mapped = mapUnknownToError(error);
			this.exceptionLogger.captureException(mapped);
			return err(mapped);
		}
	}
}
