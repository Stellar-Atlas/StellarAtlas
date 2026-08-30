import { mapUnknownToError } from 'shared';
import type { HistoryArchiveObjectFailureDTO } from '../../domain/scan/ScanCoordinatorService.js';
import type { HttpError } from 'http-helper';
export { ScannerIssueError } from '../../domain/scanner/ScannerIssueError.js';

export function describeArchiveFailure(error: unknown): string {
	const details: string[] = [];
	const seen = new Set<unknown>();
	let current = error;
	for (let depth = 0; depth < 4; depth += 1) {
		if (seen.has(current)) break;
		seen.add(current);
		const message = mapUnknownToError(current).message.trim();
		if (message.length > 0) details.push(message);
		if (typeof current !== 'object' || current === null) break;
		const record = current as Record<string, unknown>;
		const code = record.code;
		if (typeof code === 'string' || typeof code === 'number') {
			details.push('code=' + String(code));
		}
		if (record.cause === undefined || record.cause === null) break;
		current = record.cause;
	}
	const unique = Array.from(new Set(details));
	return (
		unique.length === 0 ? 'Unknown error' : unique.join('; cause: ')
	).slice(0, 4_096);
}

export function archiveEvidenceFailure(input: {
	readonly error: unknown;
	readonly errorType: string;
	readonly httpStatus?: number | null;
	readonly retryAfterSeconds?: number | null;
	readonly verificationFacts?: object | null;
}): HistoryArchiveObjectFailureDTO {
	return {
		errorMessage: describeArchiveFailure(input.error),
		errorType: input.errorType,
		failureChannel: 'archive_evidence',
		httpStatus: input.httpStatus ?? null,
		retryAfterSeconds: input.retryAfterSeconds ?? null,
		...(input.verificationFacts === undefined
			? {}
			: { verificationFacts: input.verificationFacts })
	};
}

export function archiveAvailabilityFailure(input: {
	readonly error: unknown;
	readonly errorType: string;
	readonly httpStatus?: number | null;
	readonly retryAfterSeconds?: number | null;
}): HistoryArchiveObjectFailureDTO {
	return {
		errorMessage: describeArchiveFailure(input.error),
		errorType: input.errorType,
		failureChannel: 'archive_availability',
		httpStatus: input.httpStatus ?? null,
		retryAfterSeconds: input.retryAfterSeconds ?? null
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
		errorMessage: describeArchiveFailure(input.error),
		errorType: input.errorType,
		failureChannel: 'scanner_issue',
		httpStatus: input.httpStatus ?? null
	};
}
