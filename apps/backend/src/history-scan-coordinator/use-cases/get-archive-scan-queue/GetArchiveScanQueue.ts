import 'reflect-metadata';
import { inject, injectable } from 'inversify';
import { err, ok, Result } from 'neverthrow';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';
import type {
	ArchiveScanQueueStats,
	ScanJobRepository
} from '../../domain/ScanJobRepository.js';
import {
	getStaleScanJobCutoff,
	staleScanJobAgeMs
} from '../../domain/ScanJobStaleness.js';
import { TYPES } from '../../infrastructure/di/di-types.js';

export interface ArchiveScanQueueDTO extends ArchiveScanQueueStats {
	readonly generatedAt: string;
	readonly staleJobAgeMs: number;
}

@injectable()
export class GetArchiveScanQueue {
	constructor(
		@inject(TYPES.ScanJobRepository)
		private scanJobRepository: ScanJobRepository,
		@inject('ExceptionLogger') private exceptionLogger: ExceptionLogger
	) {}

	async execute(): Promise<Result<ArchiveScanQueueDTO, Error>> {
		const generatedAt = new Date();

		try {
			const stats = await this.scanJobRepository.getQueueStats(
				getStaleScanJobCutoff(generatedAt)
			);

			return ok({
				...stats,
				generatedAt: generatedAt.toISOString(),
				staleJobAgeMs: staleScanJobAgeMs
			});
		} catch (e) {
			const error = mapUnknownToError(e);
			this.exceptionLogger.captureException(error);
			return err(error);
		}
	}
}
