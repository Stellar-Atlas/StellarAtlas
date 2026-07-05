import { ScanError } from './ScanError.js';
import { LedgerHeader } from '../scanner/Scanner.js';
import type { ScanEvidenceDTO } from 'history-scanner-dto';

export interface ScanResult {
	readonly latestLedgerHeader: LedgerHeader;
	readonly error?: ScanError;
	readonly errors?: readonly ScanError[];
	readonly evidence?: readonly ScanEvidenceDTO[];
}
