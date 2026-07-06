import 'reflect-metadata';
import { inject, injectable } from 'inversify';
import { err, ok, Result } from 'neverthrow';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';
import { TYPES as HISTORY_TYPES } from '@history-scan-coordinator/infrastructure/di/di-types.js';
import type { ScanRepository } from '@history-scan-coordinator/domain/scan/ScanRepository.js';
import type { Scan } from '@history-scan-coordinator/domain/scan/Scan.js';
import { ScanErrorType } from '@history-scan-coordinator/domain/scan/ScanError.js';
import { mapScanErrorToPublicDTO } from '@history-scan-coordinator/infrastructure/mappers/PublicScanErrorMapper.js';
import type { PublicScanErrorDTO } from '@history-scan-coordinator/infrastructure/mappers/PublicScanErrorMapper.js';
import type NetworkScan from '@network-scan/domain/network/scan/NetworkScan.js';
import type { NetworkScanRepository } from '@network-scan/domain/network/scan/NetworkScanRepository.js';
import { NETWORK_TYPES } from '@network-scan/infrastructure/di/di-types.js';

export interface NetworkScanLogEntryDTO {
	readonly archiveScheduling: NetworkScanArchiveSchedulingDTO;
	readonly completed: boolean;
	readonly latestLedger: string;
	readonly latestLedgerCloseTime: string | null;
	readonly ledgersCount: number;
	readonly status: 'ok' | 'incomplete';
	readonly time: string;
}

export interface NetworkScanArchiveSchedulingDTO {
	readonly discoveredArchiveUrlCount: number;
	readonly scheduledArchiveScanJobCount: number;
	readonly duplicateSuppressedArchiveScanJobCount: number;
	readonly schedulerErrorCount: number;
}

export interface ArchiveScanLogEntryDTO {
	readonly concurrency: number;
	readonly durationMs: number;
	readonly endDate: string;
	readonly errorCount: number;
	readonly errors: readonly PublicScanErrorDTO[];
	readonly fromLedger: number;
	readonly hasArchiveVerificationError: boolean;
	readonly hasWorkerIssue: boolean;
	readonly latestScannedLedger: number;
	readonly latestVerifiedLedger: number;
	readonly scanStatus: 'ok' | 'archive_error' | 'worker_issue';
	readonly startDate: string;
	readonly toLedger: number | null;
	readonly url: string;
}

export interface ScanLogStatusDTO {
	readonly archiveScans: readonly ArchiveScanLogEntryDTO[];
	readonly generatedAt: string;
	readonly limit: number;
	readonly networkScans: readonly NetworkScanLogEntryDTO[];
}

const defaultScanLogLimit = 12;
const maximumScanLogLimit = 50;

@injectable()
export class GetScanLogStatus {
	constructor(
		@inject(NETWORK_TYPES.NetworkScanRepository)
		private readonly networkScanRepository: NetworkScanRepository,
		@inject(HISTORY_TYPES.HistoryArchiveScanRepository)
		private readonly historyArchiveScanRepository: ScanRepository,
		@inject('ExceptionLogger') private readonly exceptionLogger: ExceptionLogger
	) {}

	async execute(
		limit = defaultScanLogLimit
	): Promise<Result<ScanLogStatusDTO, Error>> {
		const safeLimit = normalizeLimit(limit);
		const generatedAt = new Date();

		try {
			const [networkScans, archiveScans] = await Promise.all([
				this.networkScanRepository.findRecent(safeLimit),
				this.historyArchiveScanRepository.findRecentLimited(safeLimit)
			]);

			return ok({
				archiveScans: archiveScans
					.filter(isPublicArchiveScanLogEntry)
					.map(mapArchiveScanLogEntry),
				generatedAt: generatedAt.toISOString(),
				limit: safeLimit,
				networkScans: networkScans.map(mapNetworkScanLogEntry)
			});
		} catch (e) {
			const error = mapUnknownToError(e);
			this.exceptionLogger.captureException(error);
			return err(error);
		}
	}
}

function normalizeLimit(limit: number): number {
	if (!Number.isSafeInteger(limit) || limit < 1) return defaultScanLogLimit;
	return Math.min(limit, maximumScanLogLimit);
}

function mapNetworkScanLogEntry(scan: NetworkScan): NetworkScanLogEntryDTO {
	return {
		archiveScheduling: {
			discoveredArchiveUrlCount:
				scan.historyArchiveSchedulingDiscoveredUrlCount,
			scheduledArchiveScanJobCount: scan.historyArchiveSchedulingScheduledCount,
			duplicateSuppressedArchiveScanJobCount:
				scan.historyArchiveSchedulingDuplicateSuppressedCount,
			schedulerErrorCount: scan.historyArchiveSchedulingErrorCount
		},
		completed: scan.completed,
		latestLedger: scan.latestLedger.toString(),
		latestLedgerCloseTime: scan.latestLedgerCloseTime?.toISOString() ?? null,
		ledgersCount: scan.ledgers.length,
		status: scan.completed ? 'ok' : 'incomplete',
		time: scan.time.toISOString()
	};
}

function mapArchiveScanLogEntry(scan: Scan): ArchiveScanLogEntryDTO {
	const errors = scan.scanErrors
		.filter((error) => error.type === ScanErrorType.TYPE_VERIFICATION)
		.map(mapScanErrorToPublicDTO);

	return {
		concurrency: scan.concurrency,
		durationMs: Math.max(0, scan.endDate.getTime() - scan.startDate.getTime()),
		endDate: scan.endDate.toISOString(),
		errorCount: errors.length,
		errors,
		fromLedger: scan.fromLedger,
		hasArchiveVerificationError: scan.hasArchiveVerificationError(),
		hasWorkerIssue: false,
		latestScannedLedger: scan.latestScannedLedger,
		latestVerifiedLedger: scan.latestVerifiedLedger,
		scanStatus: getArchiveScanStatus(scan),
		startDate: scan.startDate.toISOString(),
		toLedger: scan.toLedger,
		url: scan.baseUrl.value
	};
}

function isPublicArchiveScanLogEntry(scan: Scan): boolean {
	return scan.concurrency > 0 || scan.hasArchiveVerificationError();
}

function getArchiveScanStatus(
	scan: Scan
): ArchiveScanLogEntryDTO['scanStatus'] {
	if (scan.hasArchiveVerificationError()) return 'archive_error';
	return 'ok';
}
