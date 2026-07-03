import 'reflect-metadata';
import { inject, injectable } from 'inversify';
import { err, ok, Result } from 'neverthrow';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
import { Url } from '@core/domain/Url.js';
import type { Scan } from '../../domain/scan/Scan.js';
import type { ScanRepository } from '../../domain/scan/ScanRepository.js';
import type { ScanError } from '../../domain/scan/ScanError.js';
import { ScanErrorType } from '../../domain/scan/ScanError.js';
import { TYPES } from '../../infrastructure/di/di-types.js';
import { InvalidUrlError } from '../get-latest-scan/InvalidUrlError.js';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';
import type { ScanJobRepository } from '../../domain/ScanJobRepository.js';
import type { ScanJob } from '../../domain/ScanJob.js';

export type HistoryArchiveScanLogStatus = 'completed' | 'queued' | 'scanning';

export interface HistoryArchiveScanLogEntryDTO {
	readonly concurrency: number;
	readonly durationMs: number;
	readonly endDate: Date;
	readonly errors: readonly HistoryArchiveScanLogErrorDTO[];
	readonly fromLedger: number;
	readonly hasArchiveVerificationError: boolean;
	readonly hasError: boolean;
	readonly hasWorkerIssue: boolean;
	readonly isSlowArchive: boolean;
	readonly latestScannedLedger: number;
	readonly latestVerifiedLedger: number;
	readonly startDate: Date;
	readonly status: HistoryArchiveScanLogStatus;
	readonly toLedger: number | null;
	readonly url: string;
	readonly updatedAt: Date;
}

export interface HistoryArchiveScanLogErrorDTO {
	readonly message: string;
	readonly type: string;
	readonly url: string;
}

@injectable()
export class GetScanLogs {
	private static readonly maxEntries = 10;
	private static readonly maxStoredScansToInspect = 50;
	private static readonly maxActiveJobs = 3;
	private static readonly maxVisibleConcurrency = 24;

	constructor(
		@inject(TYPES.HistoryArchiveScanRepository)
		private scanRepository: ScanRepository,
		@inject(TYPES.ScanJobRepository)
		private scanJobRepository: ScanJobRepository,
		@inject('ExceptionLogger') private exceptionLogger: ExceptionLogger
	) {}

	async execute(
		url: string
	): Promise<
		Result<
			readonly HistoryArchiveScanLogEntryDTO[],
			InvalidUrlError | Error
		>
	> {
		const urlOrError = Url.create(url);
		if (urlOrError.isErr()) return err(new InvalidUrlError(url));

		try {
			const normalizedUrl = urlOrError.value.value;
			const [activeJobs, scans] = await Promise.all([
				this.scanJobRepository.findActiveByUrl(
					normalizedUrl,
					GetScanLogs.maxActiveJobs
				),
				this.scanRepository.findRecentByUrl(
					normalizedUrl,
					GetScanLogs.maxStoredScansToInspect
				)
			]);

			const publicCompletedScans = scans
				.filter((scan) => this.shouldShowCompletedScan(scan))
				.slice(0, GetScanLogs.maxEntries);

			return ok([
				...activeJobs.map((job) => this.mapActiveJob(job)),
				...publicCompletedScans.map((scan) => this.mapScan(scan))
			]);
		} catch (e) {
			const error = mapUnknownToError(e);
			this.exceptionLogger.captureException(error);
			return err(error);
		}
	}

	private mapActiveJob(job: ScanJob): HistoryArchiveScanLogEntryDTO {
		const now = new Date();
		const startDate = job.createdAt ?? now;
		const updatedAt = job.updatedAt ?? now;
		const fromLedger =
			job.fromLedger ??
			(job.latestScannedLedger > 0 ? job.latestScannedLedger + 1 : 0);

		return {
			concurrency: this.mapVisibleConcurrency(job.concurrency),
			durationMs: now.getTime() - startDate.getTime(),
			endDate: updatedAt,
			errors: [],
			fromLedger,
			hasArchiveVerificationError: false,
			hasError: false,
			hasWorkerIssue: false,
			isSlowArchive: false,
			latestScannedLedger: job.latestScannedLedger,
			latestVerifiedLedger: job.latestScannedLedger,
			startDate,
			status: job.status === 'TAKEN' ? 'scanning' : 'queued',
			toLedger: job.toLedger,
			updatedAt,
			url: job.url
		};
	}

	private mapVisibleConcurrency(concurrency: number | null): number {
		if (concurrency === null) return 0;

		return Math.min(concurrency, GetScanLogs.maxVisibleConcurrency);
	}

	private shouldShowCompletedScan(scan: Scan): boolean {
		if (scan.hasArchiveVerificationError()) return true;

		return !scan.hasWorkerIssue();
	}

	private mapScan(scan: Scan): HistoryArchiveScanLogEntryDTO {
		return {
			concurrency: scan.concurrency,
			durationMs: scan.endDate.getTime() - scan.startDate.getTime(),
			endDate: scan.endDate,
			errors: scan.scanErrors.map((error) => ({
				message: error.message,
				type: ScanErrorType[error.type],
				url: error.url
			})),
			fromLedger: scan.fromLedger,
			hasArchiveVerificationError: scan.hasArchiveVerificationError(),
			hasError: scan.hasError(),
			hasWorkerIssue: scan.hasWorkerIssue(),
			isSlowArchive: scan.isSlowArchive ?? false,
			latestScannedLedger: scan.latestScannedLedger,
			latestVerifiedLedger: scan.latestVerifiedLedger,
			startDate: scan.startDate,
			status: 'completed',
			toLedger: scan.toLedger,
			updatedAt: scan.endDate,
			url: scan.baseUrl.value
		};
	}
}
