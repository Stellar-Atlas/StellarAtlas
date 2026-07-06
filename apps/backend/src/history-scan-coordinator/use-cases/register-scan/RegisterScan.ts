import { injectable, inject } from 'inversify';
import { TYPES } from '../../infrastructure/di/di-types.js';
import type { ExceptionLogger } from 'exception-logger';
import { err, ok, Result } from 'neverthrow';
import { ScanMapper } from '../../infrastructure/mappers/ScanMapper.js';
import type { ScanRepository } from '../../domain/scan/ScanRepository.js';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';
import { ScanDTO } from 'history-scanner-dto';
import type { Logger } from 'logger';
import type { ScanJobRepository } from '../../domain/ScanJobRepository.js';
import type { CommunityScannerJobContext } from '../../domain/CommunityScannerJobContext.js';
import type { Repository } from 'typeorm';
import { CommunityScanner } from '../../infrastructure/database/entities/CommunityScanner.js';
import type { HistoryArchiveStateRepository } from '../../domain/history-archive-state/HistoryArchiveStateRepository.js';

export class ScanJobNotFoundError extends Error {
	constructor() {
		super('Scan job not found');
		this.name = 'ScanJobNotFoundError';
	}
}

export class ScanJobNotActiveError extends Error {
	constructor() {
		super('Scan job is not active');
		this.name = 'ScanJobNotActiveError';
	}
}

export class ScanJobOwnershipError extends Error {
	constructor() {
		super('Scan job is not claimed by this scanner');
		this.name = 'ScanJobOwnershipError';
	}
}

export class CommunityScannerAttributionNotFoundError extends Error {
	constructor() {
		super('Community scanner not found');
		this.name = 'CommunityScannerAttributionNotFoundError';
	}
}

@injectable()
export class RegisterScan {
	constructor(
		private mapper: ScanMapper,
		@inject(TYPES.HistoryArchiveScanRepository)
		private scanRepository: ScanRepository,
		@inject(TYPES.HistoryArchiveStateRepository)
		private stateRepository: HistoryArchiveStateRepository,
		@inject(TYPES.ScanJobRepository)
		private scanJobRepository: ScanJobRepository,
		@inject(TYPES.CommunityScannerRepository)
		private communityScannerRepository: Repository<CommunityScanner>,
		@inject('ExceptionLogger') private exceptionLogger: ExceptionLogger,
		@inject('Logger') private logger: Logger
	) {}

	async execute(
		dto: ScanDTO,
		context?: CommunityScannerJobContext
	): Promise<Result<void, Error>> {
		this.logger.info(`Registering scan: ${dto.baseUrl}`);

		try {
			const attributedJob =
				context === undefined
					? null
					: await this.getValidatedCommunityScannerJob(
							dto.scanJobRemoteId,
							context.communityScannerId
						);
			if (attributedJob instanceof Error) return err(attributedJob);
			const attributedScanner =
				context === undefined
					? null
					: await this.communityScannerRepository.findOne({
							where: { id: context.communityScannerId }
						});
			if (context !== undefined && attributedScanner === null) {
				return err(new CommunityScannerAttributionNotFoundError());
			}

			const scanResult = this.mapper.toDomain(dto, {
				communityScannerId: context?.communityScannerId,
				scanJobRemoteId: dto.scanJobRemoteId
			});
			if (scanResult.isErr()) {
				this.exceptionLogger.captureException(scanResult.error);
				return err(scanResult.error);
			}

			await this.scanRepository.save([scanResult.value]);
			if (scanResult.value.archiveMetadata !== null) {
				await this.stateRepository.saveAvailable(
					scanResult.value.baseUrl.value,
					scanResult.value.archiveMetadata,
					'history-scanner'
				);
			}
			const scanJob =
				attributedJob ??
				(await this.scanJobRepository.findByRemoteId(dto.scanJobRemoteId));
			if (scanJob === null) {
				this.logger.info(
					`No scan job found for remoteId: ${dto.scanJobRemoteId}`
				);
			} else {
				scanJob.status = 'DONE';
				await this.scanJobRepository.save([scanJob]);
				if (attributedScanner !== null) {
					// Archive verification errors describe archive evidence, not scanner reliability.
					await this.updateCommunityScannerMetrics(
						attributedScanner,
						scanJob.claimedAt ??
							scanJob.updatedAt ??
							scanResult.value.startDate,
						scanResult.value.endDate,
						!scanResult.value.hasWorkerIssue()
					);
				}
			}

			this.logger.info(`Scan registered: ${scanResult.value.baseUrl.value}`);
		} catch (e) {
			const error = mapUnknownToError(e);
			this.exceptionLogger.captureException(error);
			return err(error);
		}

		return ok(undefined);
	}

	private async getValidatedCommunityScannerJob(
		remoteId: string,
		communityScannerId: string
	) {
		const scanJob = await this.scanJobRepository.findByRemoteId(remoteId);
		if (scanJob === null) return new ScanJobNotFoundError();
		if (scanJob.status !== 'TAKEN') return new ScanJobNotActiveError();
		if (scanJob.claimedByCommunityScannerId !== communityScannerId) {
			return new ScanJobOwnershipError();
		}

		return scanJob;
	}

	private async updateCommunityScannerMetrics(
		scanner: CommunityScanner,
		startedAt: Date,
		endedAt: Date,
		completedWithoutWorkerIssue: boolean
	): Promise<void> {
		const completionTimeMs = Math.max(
			0,
			endedAt.getTime() - startedAt.getTime()
		);
		scanner.updatePerformanceMetrics(
			completionTimeMs,
			completedWithoutWorkerIssue
		);
		await this.communityScannerRepository.save(scanner);
	}
}
