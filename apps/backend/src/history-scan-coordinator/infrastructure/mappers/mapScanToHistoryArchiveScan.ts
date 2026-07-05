import { HistoryArchiveScan } from 'shared';
import type { Scan } from '../../domain/scan/Scan.js';
import { ScanErrorType } from '../../domain/scan/ScanError.js';
import { mapScanErrorToPublicDTO } from './PublicScanErrorMapper.js';

export function mapScanToHistoryArchiveScan(scan: Scan): HistoryArchiveScan {
	const scanErrors = scan.scanErrors;
	const archiveVerificationErrors = scanErrors.filter(
		(error) => error.type === ScanErrorType.TYPE_VERIFICATION
	);
	const firstArchiveVerificationError = archiveVerificationErrors[0] ?? null;

	return new HistoryArchiveScan(
		scan.baseUrl.value,
		scan.startDate,
		scan.endDate,
		scan.latestVerifiedLedger,
		archiveVerificationErrors.length > 0,
		firstArchiveVerificationError?.url ?? null,
		firstArchiveVerificationError?.message ?? null,
		scan.isSlowArchive ?? false,
		archiveVerificationErrors.map(mapScanErrorToPublicDTO),
		scan.archiveMetadata
	);
}
