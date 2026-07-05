import { ScanError, ScanErrorType } from '../../domain/scan/ScanError.js';

export interface PublicScanErrorDTO {
	readonly message: string;
	readonly type: string;
	readonly url: string;
}

const localHistoryCachePathPattern =
	/(["'])?\/home\/observe\/stellarbeat-data\/Observer\/history-bucket-cache(?:\/[A-Za-z0-9._-]+)*\1?/g;

export function mapScanErrorToPublicDTO(error: ScanError): PublicScanErrorDTO {
	return {
		message: sanitizeScanErrorMessage(error),
		type: ScanErrorType[error.type],
		url: sanitizeScanErrorUrl(error.url)
	};
}

function sanitizeScanErrorMessage(error: ScanError): string {
	if (error.type === ScanErrorType.TYPE_VERIFICATION) return error.message;

	return error.message.replace(
		localHistoryCachePathPattern,
		'[history bucket cache path]'
	);
}

function sanitizeScanErrorUrl(url: string): string {
	try {
		const parsedUrl = new URL(url);
		if (parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:') {
			return url;
		}
	} catch {
		return 'worker-infrastructure';
	}

	return 'worker-infrastructure';
}
