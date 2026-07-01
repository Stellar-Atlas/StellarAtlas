import { ScanError, ScanErrorType } from './ScanError.js';

export interface ScanErrorDetails {
	readonly type: keyof typeof ScanErrorType;
	readonly url: string;
	readonly message: string;
}

export function mapScanErrorToDetails(error: ScanError): ScanErrorDetails {
	return {
		type: ScanErrorType[error.type] as keyof typeof ScanErrorType,
		url: error.url,
		message: error.message
	};
}

export function mapDetailsToScanError(
	details: ScanErrorDetails
): ScanError | null {
	const type = ScanErrorType[details.type];
	if (type === undefined) return null;

	return new ScanError(type, details.url, details.message);
}
