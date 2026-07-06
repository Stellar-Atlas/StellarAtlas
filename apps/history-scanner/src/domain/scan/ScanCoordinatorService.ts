import { Result } from 'neverthrow';
import { Scan } from './Scan.js';
import {
	type ParsedLedgerHeaderBatchDTO,
	ScanJobDTO
} from 'history-scanner-dto';

export interface ScanJobProgressDTO {
	readonly concurrency?: number;
	readonly currentRangeFromLedger?: number | null;
	readonly currentRangeToLedger?: number | null;
	readonly fromLedger?: number;
	readonly latestAttemptedLedger?: number;
	readonly latestScannedLedger?: number;
	readonly latestScannedLedgerHeaderHash?: string | null;
	readonly toLedger?: number | null;
}

export interface ScanCoordinatorService {
	registerScan(scan: Scan): Promise<Result<void, Error>>;
	registerParsedLedgerHeaders(
		batch: ParsedLedgerHeaderBatchDTO
	): Promise<Result<void, Error>>;
	getScanJob(): Promise<Result<ScanJobDTO | null, Error>>;
	releaseScanJob(remoteId: string): Promise<Result<void, Error>>;
	touchScanJob(
		remoteId: string,
		progress?: ScanJobProgressDTO
	): Promise<Result<void, Error>>;
}
