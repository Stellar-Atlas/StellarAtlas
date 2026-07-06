import type { ArchiveMetadataDTO } from 'history-scanner-dto';
import type { ScanError } from './ScanError.js';

//Actual settings used for scan, if necessary determined just before starting the scan
export interface ScanSettings {
	readonly fromLedger: number;
	readonly toLedger: number;
	readonly concurrency: number;
	readonly isSlowArchive: boolean | null;
	readonly latestScannedLedger: number;
	readonly latestScannedLedgerHeaderHash: string | null;
	readonly archiveMetadata?: ArchiveMetadataDTO;
	readonly errors?: readonly ScanError[];
}
