import { ScanDTO, type ScanErrorDTO } from 'history-scanner-dto';
import { type ScanError, ScanErrorType } from '../../domain/scan/ScanError.js';
import { Scan } from '../../domain/scan/Scan.js';

export function mapScanToDTO(scan: Scan): ScanDTO {
	const errors = scan.errors.map(mapScanErrorToDTO);
	return {
		archiveMetadata: scan.archiveMetadata ?? undefined,
		baseUrl: scan.baseUrl.value,
		concurrency: scan.concurrency,
		endDate: scan.endDate,
		error: scan.error ? mapScanErrorToDTO(scan.error) : null,
		errors,
		evidence: scan.evidence,
		fromLedger: scan.fromLedger,
		isSlowArchive: scan.isSlowArchive,
		latestScannedLedger: scan.latestScannedLedger,
		latestScannedLedgerHeaderHash: scan.latestScannedLedgerHeaderHash,
		latestVerifiedLedger: scan.latestVerifiedLedger,
		scanChainInitDate: scan.scanChainInitDate,
		scanJobRemoteId: scan.scanJobRemoteId!,
		startDate: scan.startDate,
		toLedger: scan.toLedger
	};
}

function mapScanErrorToDTO(error: ScanError): ScanErrorDTO {
	return {
		message: error.message,
		type: mapScanErrorTypeToDTO(error.type),
		url: error.url
	};
}

function mapScanErrorTypeToDTO(type: ScanErrorType): ScanErrorDTO['type'] {
	switch (type) {
		case ScanErrorType.TYPE_VERIFICATION:
			return 'TYPE_VERIFICATION';
		case ScanErrorType.TYPE_CONNECTION:
			return 'TYPE_CONNECTION';
	}
}
