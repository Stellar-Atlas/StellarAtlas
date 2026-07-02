import { HistoryArchiveScan } from 'shared';
import type { Scan } from '../../domain/scan/Scan.js';
import { ScanErrorType } from '../../domain/scan/ScanError.js';

export function mapScanToHistoryArchiveScan(scan: Scan): HistoryArchiveScan {
	const scanErrors = scan.scanErrors;
	const firstError = scanErrors[0] ?? null;

	return new HistoryArchiveScan(
		scan.baseUrl.value,
		scan.startDate,
		scan.endDate,
		scan.latestVerifiedLedger,
		scanErrors.length > 0,
		firstError?.url ?? null,
		firstError?.message ?? null,
		scan.isSlowArchive ?? false,
		scanErrors.map((error) => ({
			message: error.message,
			type: ScanErrorType[error.type],
			url: error.url
		}))
	);
}
