import { HistoryArchiveScan } from 'shared';
import type { Scan } from '../../domain/scan/Scan.js';
import { ScanErrorType } from '../../domain/scan/ScanError.js';

export function mapScanToHistoryArchiveScan(scan: Scan): HistoryArchiveScan {
	const verificationErrors = scan.scanErrors.filter(
		(error) => error.type === ScanErrorType.TYPE_VERIFICATION
	);
	const firstVerificationError = verificationErrors[0] ?? null;

	return new HistoryArchiveScan(
		scan.baseUrl.value,
		scan.startDate,
		scan.endDate,
		scan.latestVerifiedLedger,
		verificationErrors.length > 0,
		firstVerificationError?.url ?? null,
		firstVerificationError?.message ?? null,
		scan.isSlowArchive ?? false,
		verificationErrors.map((error) => ({
			message: error.message,
			type: ScanErrorType[error.type],
			url: error.url
		}))
	);
}
