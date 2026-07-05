import 'reflect-metadata';
import { inject, injectable } from 'inversify';
import { err, ok, Result } from 'neverthrow';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';
import type { ScanJobRepository } from '../../domain/ScanJobRepository.js';
import { TYPES } from '../../infrastructure/di/di-types.js';

@injectable()
export class ReleaseScanJob {
	constructor(
		@inject(TYPES.ScanJobRepository)
		private scanJobRepository: ScanJobRepository,
		@inject('ExceptionLogger') private exceptionLogger: ExceptionLogger
	) {}

	async execute(remoteId: string): Promise<Result<boolean, Error>> {
		try {
			return ok(await this.scanJobRepository.releaseTakenJob(remoteId));
		} catch (e) {
			const error = mapUnknownToError(e);
			this.exceptionLogger.captureException(error);
			return err(error);
		}
	}
}
