import 'reflect-metadata';
import { err, ok, Result } from 'neverthrow';
import type {
	ScheduleScanJobsResultDTO,
	ScheduleScansDTO as ScheduleScanJobsDTO
} from './ScheduleScanJobsDTO.js';
import { inject, injectable } from 'inversify';
import { TYPES } from '../../infrastructure/di/di-types.js';
import type { ScanRepository } from '../../domain/scan/ScanRepository.js';
import type { ScanScheduler } from '../../domain/ScanScheduler.js';
import type { Logger } from 'logger';
import type { ScanJobRepository } from '../../domain/ScanJobRepository.js';
import { getStaleScanJobCutoff } from '../../domain/ScanJobStaleness.js';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';
import { ScanJob } from '@history-scan-coordinator/domain/ScanJob.js';
import { getHistoryArchiveUrlIdentity } from '@history-scan-coordinator/domain/ArchiveUrlIdentity.js';

/**
 * Schedule scansJobs and adds them to the queue. If the scan queue is empty, new ScanJobs will be created.
 * Could be improved in the future to check if a scan is already pending for a given url.
 * For now we will only create new ScanJobs if the queue is empty.
 *
 * Make sure that only 1 process calls this usecase to avoid race conditions.
 * At the moment the network-scanner, and more in particular, the node-scanner calls this use-case
 *
 * To avoid any race conditions, this could be periodically called with a cronjob
 */
@injectable()
export class ScheduleScanJobs {
	constructor(
		@inject(TYPES.HistoryArchiveScanRepository)
		private scanRepository: ScanRepository,
		@inject(TYPES.ScanJobRepository)
		private scanJobRepository: ScanJobRepository,
		@inject(TYPES.ScanScheduler)
		private scanScheduler: ScanScheduler,
		@inject('Logger') private logger: Logger
	) {}

	public async execute(
		dto: ScheduleScanJobsDTO
	): Promise<Result<ScheduleScanJobsResultDTO, Error>> {
		try {
			const result = await this.scanJobRepository.withSchedulingLock(
				async () => {
					await this.releaseStaleJobs();
					return await this.scheduleScanJobs(dto, await this.isQueueEmpty());
				}
			);

			return ok(result);
		} catch (e) {
			const error = mapUnknownToError(e);
			this.logger.error('Failed to schedule scan jobs', {
				app: 'history-scan-coordinator',
				errorMessage: error.message
			});

			return err(error);
		}
	}

	private async releaseStaleJobs(): Promise<void> {
		const released = await this.scanJobRepository.releaseStaleTakenJobs(
			getStaleScanJobCutoff()
		);

		if (released > 0) {
			this.logger.info('Released stale scan jobs', {
				app: 'history-scan-coordinator',
				released
			});
		}
	}

	private async isQueueEmpty(): Promise<boolean> {
		return !(await this.scanJobRepository.hasPendingJobs());
	}

	private async scheduleScanJobs(
		dto: ScheduleScanJobsDTO,
		queueIsEmpty: boolean
	): Promise<ScheduleScanJobsResultDTO> {
		const previousScans = await this.scanRepository.findLatest();
		//jobs that are running for over 4 days are considered failed
		const unfinishedScanJobs = await this.scanJobRepository.findUnfinishedJobs(
			getStaleScanJobCutoff()
		); //todo: this should be configurable

		const scanJobs = this.scanScheduler.schedule(
			[...dto.historyArchiveUrls],
			previousScans,
			unfinishedScanJobs,
			{ includeRegularJobs: queueIsEmpty }
		);

		const scheduledCount =
			scanJobs.length > 0 ? await this.scanJobRepository.save(scanJobs) : 0;
		const duplicateSuppressedCount =
			calculateDuplicateSuppressedArchiveScanJobCount(
				dto.historyArchiveUrls,
				scanJobs,
				unfinishedScanJobs,
				scheduledCount
			);

		this.logger.info('Scheduling new scan jobs', {
			app: 'history-scan-coordinator',
			historyArchiveUrls: dto.historyArchiveUrls,
			fullScans: scanJobs
				.filter((job) => job.chainInitDate === null)
				.map((job) => job.url),
			scheduledCount,
			duplicateSuppressedCount
		});

		return {
			discoveredArchiveUrlCount: dto.historyArchiveUrls.length,
			scheduledArchiveScanJobCount: scheduledCount,
			duplicateSuppressedArchiveScanJobCount: duplicateSuppressedCount,
			schedulerErrorCount: 0
		};
	}
}

function calculateDuplicateSuppressedArchiveScanJobCount(
	historyArchiveUrls: readonly string[],
	scanJobs: readonly ScanJob[],
	unfinishedScanJobs: readonly ScanJob[],
	scheduledCount: number
): number {
	const validArchiveUrls = historyArchiveUrls
		.map(normalizeHistoryArchiveUrl)
		.filter((url): url is string => url !== null);
	const uniqueArchiveUrls = Array.from(new Set(validArchiveUrls));
	const duplicateDiscoveredCount =
		validArchiveUrls.length - uniqueArchiveUrls.length;
	const scheduledUrls = new Set(
		scanJobs
			.map((job) => normalizeHistoryArchiveUrl(job.url))
			.filter((url): url is string => url !== null)
	);
	const unfinishedUrls = new Set(
		unfinishedScanJobs
			.map((job) => normalizeHistoryArchiveUrl(job.url))
			.filter((url): url is string => url !== null)
	);
	const unfinishedSuppressedCount = uniqueArchiveUrls.filter(
		(url) => unfinishedUrls.has(url) && !scheduledUrls.has(url)
	).length;
	const repositorySuppressedCount = Math.max(
		0,
		scanJobs.length - scheduledCount
	);

	return (
		duplicateDiscoveredCount +
		unfinishedSuppressedCount +
		repositorySuppressedCount
	);
}

function normalizeHistoryArchiveUrl(url: string): string | null {
	return getHistoryArchiveUrlIdentity(url);
}
