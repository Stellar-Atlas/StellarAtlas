import 'reflect-metadata';
import { inject, injectable } from 'inversify';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
import { TYPES } from '../../infrastructure/di/di-types.js';
import { err, ok, Result } from 'neverthrow';
import { ScanJobDTO } from 'history-scanner-dto';
import type { Logger } from 'logger';
import type { ScanJobRepository } from '../../domain/ScanJobRepository.js';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';
import { getStaleScanJobCutoff } from '../../domain/ScanJobStaleness.js';
import type { CommunityScannerJobContext } from '../../domain/CommunityScannerJobContext.js';
import { communityScannerClaimPolicy } from '../../domain/CommunityScannerClaimPolicy.js';

/**
 * Schedules new scan jobs for history archives based on a configured scheduling strategy.
 * */
@injectable()
export class GetScanJob {
	static readonly maxActiveCommunityScannerJobs =
		communityScannerClaimPolicy.maxActiveJobsPerScanner;

	constructor(
		@inject(TYPES.ScanJobRepository)
		private scanJobRepository: ScanJobRepository,
		@inject('ExceptionLogger') private exceptionLogger: ExceptionLogger,
		@inject('Logger') private logger: Logger
	) {}

	public async execute(
		context?: CommunityScannerJobContext
	): Promise<Result<ScanJobDTO | null, Error>> {
		try {
			const staleTakenBefore = getStaleScanJobCutoff();
			await this.releaseStaleJobs(staleTakenBefore);
			const nextScanJob =
				context === undefined
					? await this.scanJobRepository.fetchNextJob()
					: await this.scanJobRepository.fetchNextJobForCommunityScanner(
							context.communityScannerId,
							GetScanJob.maxActiveCommunityScannerJobs,
							staleTakenBefore
						);

			if (nextScanJob === null) {
				this.logger.info('No scan jobs available', {
					app: 'history-scan-coordinator'
				});

				return ok(null);
			}

			this.logger.info('Returning next scan job', {
				app: 'history-scan-coordinator',
				url: nextScanJob.url,
				chainInitDate: nextScanJob.chainInitDate
			});

			return ok({
				chainInitDate: nextScanJob.chainInitDate,
				url: nextScanJob.url,
				latestScannedLedger: nextScanJob.latestScannedLedger,
				latestScannedLedgerHeaderHash:
					nextScanJob.latestScannedLedgerHeaderHash,
				remoteId: nextScanJob.remoteId,
				fromLedger: nextScanJob.fromLedger,
				toLedger: nextScanJob.toLedger,
				concurrency: nextScanJob.concurrency
			});
		} catch (e) {
			const error = mapUnknownToError(e);
			this.exceptionLogger.captureException(error);
			return err(error);
		}
	}

	private async releaseStaleJobs(staleTakenBefore: Date): Promise<void> {
		const released =
			await this.scanJobRepository.releaseStaleTakenJobs(staleTakenBefore);

		if (released > 0) {
			this.logger.info('Released stale scan jobs', {
				app: 'history-scan-coordinator',
				released
			});
		}
	}
}
