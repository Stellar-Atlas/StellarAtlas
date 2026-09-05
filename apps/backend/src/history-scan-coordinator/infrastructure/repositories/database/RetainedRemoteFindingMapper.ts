import { mapPublicArchiveError } from '../../mappers/PublicArchiveObjectFactsMapper.js';
import type { KnownArchiveRemoteFailureV1 } from 'shared';

export function mapRetainedRemoteFinding(
	value: unknown
): KnownArchiveRemoteFailureV1['retainedFinding'] {
	if (value === undefined || value === null) return undefined;
	if (typeof value !== 'object' || Array.isArray(value)) {
		throw new Error('Invalid retained source finding');
	}
	const row = value as Readonly<Record<string, unknown>>;
	if (
		(row.failureChannel !== 'archive_evidence' &&
			row.failureChannel !== 'archive_availability') ||
		typeof row.observedAt !== 'string' ||
		!nullableString(row.errorType) ||
		!nullableString(row.errorMessage) ||
		!(
			row.httpStatus === null ||
			(typeof row.httpStatus === 'number' && Number.isInteger(row.httpStatus))
		)
	)
		throw new Error('Invalid retained source finding');
	const observedAt = new Date(row.observedAt);
	if (Number.isNaN(observedAt.getTime()))
		throw new Error('Invalid retained finding time');
	const error = mapPublicArchiveError({
		errorType: row.errorType,
		errorMessage: row.errorMessage,
		failureChannel: row.failureChannel,
		httpStatus: row.httpStatus
	});
	return {
		observedAt: observedAt.toISOString(),
		failureChannel: row.failureChannel,
		errorType: error?.type ?? null,
		errorMessage: error?.message ?? null,
		httpStatus: error?.httpStatus ?? null
	};
}

function nullableString(value: unknown): value is string | null {
	return value === null || typeof value === 'string';
}
