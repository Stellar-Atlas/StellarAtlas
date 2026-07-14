import { mapUnknownToError } from 'shared';
import type { HistoryArchiveObjectFailureDTO } from '../../domain/scan/ScanCoordinatorService.js';
import type { HttpError } from 'http-helper';
export { ScannerIssueError } from '../../domain/scanner/ScannerIssueError.js';

export function archiveEvidenceFailure(input: {
	readonly error: unknown;
	readonly errorType: string;
	readonly httpStatus?: number | null;
	readonly retryAfterSeconds?: number | null;
	readonly verificationFacts?: object | null;
}): HistoryArchiveObjectFailureDTO {
	return {
		errorMessage: mapUnknownToError(input.error).message,
		errorType: input.errorType,
		failureChannel: 'archive_evidence',
		httpStatus: input.httpStatus ?? null,
		retryAfterSeconds: input.retryAfterSeconds ?? null,
		...(input.verificationFacts === undefined
			? {}
			: { verificationFacts: input.verificationFacts })
	};
}

export function getRetryAfterSecondsFromHttpError(
	error: HttpError,
	now = new Date()
): number | null {
	const value = readHeader(error.response?.headers, 'retry-after');
	if (value === null) return null;
	const seconds = Number(value);
	if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
	const at = new Date(value);
	if (Number.isNaN(at.getTime())) return null;
	return Math.max(0, Math.ceil((at.getTime() - now.getTime()) / 1000));
}

function readHeader(headers: unknown, name: string): string | null {
	if (typeof headers !== 'object' || headers === null) return null;
	const get = Reflect.get(headers, 'get');
	if (typeof get === 'function') {
		const value = Reflect.apply(get, headers, [name]);
		return typeof value === 'string' || typeof value === 'number'
			? String(value)
			: null;
	}
	const record = headers as Record<string, unknown>;
	const value = record[name] ?? record['Retry-After'];
	if (Array.isArray(value)) return value.length === 0 ? null : String(value[0]);
	return typeof value === 'string' || typeof value === 'number'
		? String(value)
		: null;
}

export function scannerIssueFailure(input: {
	readonly error: unknown;
	readonly errorType: string;
	readonly httpStatus?: number | null;
}): HistoryArchiveObjectFailureDTO {
	return {
		errorMessage: mapUnknownToError(input.error).message,
		errorType: input.errorType,
		failureChannel: 'scanner_issue',
		httpStatus: input.httpStatus ?? null
	};
}
