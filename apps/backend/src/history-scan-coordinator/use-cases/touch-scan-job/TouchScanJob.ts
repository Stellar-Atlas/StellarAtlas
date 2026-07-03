import 'reflect-metadata';
import { inject, injectable } from 'inversify';
import { err, ok, Result } from 'neverthrow';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';
import type { ScanJobRepository } from '../../domain/ScanJobRepository.js';
import { TYPES } from '../../infrastructure/di/di-types.js';
import type { CommunityScannerJobContext } from '../../domain/CommunityScannerJobContext.js';

@injectable()
export class TouchScanJob {
	constructor(
		@inject(TYPES.ScanJobRepository)
		private scanJobRepository: ScanJobRepository,
		@inject('ExceptionLogger') private exceptionLogger: ExceptionLogger
	) {}

	async execute(
		remoteId: string,
		context?: CommunityScannerJobContext
	): Promise<Result<boolean, Error>> {
		try {
			const wasUpdated =
				context === undefined
					? await this.scanJobRepository.markTakenJobActive(remoteId)
					: await this.scanJobRepository.markTakenJobActiveForCommunityScanner(
							remoteId,
							context.communityScannerId
						);
			return ok(wasUpdated);
		} catch (e) {
			const error = mapUnknownToError(e);
			this.exceptionLogger.captureException(error);
			return err(error);
		}
	}
}
