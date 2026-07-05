import { Result } from 'neverthrow';
import { Scan } from './Scan.js';
import {
	type ParsedLedgerHeaderBatchDTO,
	ScanJobDTO
} from 'history-scanner-dto';

export interface ScanCoordinatorService {
	registerScan(scan: Scan): Promise<Result<void, Error>>;
	registerParsedLedgerHeaders(
		batch: ParsedLedgerHeaderBatchDTO
	): Promise<Result<void, Error>>;
	getScanJob(): Promise<Result<ScanJobDTO | null, Error>>;
	touchScanJob(remoteId: string): Promise<Result<void, Error>>;
}
