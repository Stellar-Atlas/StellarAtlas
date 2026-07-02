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
	readonly toLedger: number | null;
	readonly url: string;
}

export interface HistoryArchiveScanLogErrorDTO {
	readonly message: string;
	readonly type: string;
	readonly url: string;
}

@injectable()
export class GetScanLogs {
	private static readonly maxEntries = 10;

	constructor(
		@inject(TYPES.HistoryArchiveScanRepository)
		private scanRepository: ScanRepository,
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
			const scans = await this.scanRepository.findRecentByUrl(
				urlOrError.value.value,
				GetScanLogs.maxEntries
			);
			return ok(scans.map((scan) => this.mapScan(scan)));
		} catch (e) {
			const error = mapUnknownToError(e);
			this.exceptionLogger.captureException(error);
			return err(error);
		}
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
			toLedger: scan.toLedger,
			url: scan.baseUrl.value
		};
	}
}
