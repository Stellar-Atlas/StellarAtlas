import type { HistoryArchiveObjectFailureDTO } from '../../domain/scan/ScanCoordinatorService.js';
import { isArchiveXdrError } from '../../domain/scanner/hash-worker.js';
import {
	archiveEvidenceFailure,
	ScannerIssueError,
	scannerIssueFailure
} from './ArchiveObjectFailure.js';

const transportErrorCodes = new Set([
	'ABORT_ERR',
	'ECONNABORTED',
	'ECONNRESET',
	'ENETRESET',
	'EPIPE',
	'ERR_REQUEST_ABORTED',
	'ERR_STREAM_PREMATURE_CLOSE',
	'ETIMEDOUT',
	'UND_ERR_ABORTED',
	'UND_ERR_BODY_TIMEOUT',
	'UND_ERR_CONNECT_TIMEOUT',
	'UND_ERR_HEADERS_TIMEOUT',
	'UND_ERR_SOCKET',
	'Z_BUF_ERROR'
]);

const contentErrorCodes = new Set(['Z_DATA_ERROR']);

export function classifyCategoryVerificationFailure(
	error: unknown,
	httpStatus: number
): HistoryArchiveObjectFailureDTO {
	if (error instanceof ScannerIssueError) {
		return scannerIssueFailure({
			error,
			errorType: 'category_scanner_failure'
		});
	}
	if (isArchiveXdrError(error) || hasErrorCode(error, contentErrorCodes)) {
		return archiveEvidenceFailure({
			error,
			errorType: 'category_content_invalid',
			httpStatus
		});
	}
	if (hasErrorCode(error, transportErrorCodes)) {
		return archiveEvidenceFailure({
			error,
			errorType: 'archive_transport_error',
			httpStatus
		});
	}
	return scannerIssueFailure({
		error,
		errorType: 'category_pipeline_failure'
	});
}

function hasErrorCode(error: unknown, codes: ReadonlySet<string>): boolean {
	let current: unknown = error;
	const seen = new Set<unknown>();
	while (
		typeof current === 'object' &&
		current !== null &&
		!seen.has(current)
	) {
		seen.add(current);
		const candidate = current as {
			readonly cause?: unknown;
			readonly code?: unknown;
		};
		if (typeof candidate.code === 'string' && codes.has(candidate.code)) {
			return true;
		}
		current = candidate.cause;
	}
	return false;
}
