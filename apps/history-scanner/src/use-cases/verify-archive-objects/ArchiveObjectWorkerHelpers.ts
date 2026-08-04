import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { isHttpError } from 'http-helper';
import { err, ok, type Result } from 'neverthrow';
import { mapUnknownToError } from 'shared';
import type { HistoryArchiveObjectFailureDTO } from '../../domain/scan/ScanCoordinatorService.js';
import {
	archiveEvidenceFailure,
	getRetryAfterSecondsFromHttpError,
	scannerIssueFailure
} from './ArchiveObjectFailure.js';

export function isReadableArchiveObject(value: unknown): value is Readable {
	return (
		typeof value === 'object' &&
		value !== null &&
		'pipe' in value &&
		typeof value.pipe === 'function'
	);
}

export function mapArchiveObjectHttpError(
	error: unknown
): HistoryArchiveObjectFailureDTO {
	if (isHttpError(error)) {
		return archiveEvidenceFailure({
			error,
			errorType: error.response
				? 'archive_http_error'
				: 'archive_transport_error',
			httpStatus: error.response?.status ?? null,
			retryAfterSeconds: getRetryAfterSecondsFromHttpError(error)
		});
	}

	return scannerIssueFailure({ error, errorType: 'http_client_failure' });
}

export function mapArchiveObjectLocalError(
	error: unknown
): HistoryArchiveObjectFailureDTO {
	return scannerIssueFailure({ error, errorType: 'worker_setup_failure' });
}

export async function verifyBucketHash(
	readStream: Readable,
	expectedHash: string
): Promise<Result<void, Error>> {
	const zlib = createGunzip();
	const hasher = createHash('sha256');

	try {
		await pipeline(readStream, zlib, hasher);
		const digest = hasher.digest('hex');
		return digest === expectedHash.toLowerCase()
			? ok(undefined)
			: err(new Error('Wrong bucket hash'));
	} catch (error) {
		return err(mapUnknownToError(error));
	}
}
