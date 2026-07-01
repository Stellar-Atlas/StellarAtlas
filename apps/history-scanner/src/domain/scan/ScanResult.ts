import { ScanError } from './ScanError.js';
import { LedgerHeader } from '../scanner/Scanner.js';

export interface ScanResult {
	readonly latestLedgerHeader: LedgerHeader;
	readonly error?: ScanError;
	readonly errors?: readonly ScanError[];
}
