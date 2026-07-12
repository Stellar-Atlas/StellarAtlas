import { err, ok, Result } from 'neverthrow';
import { isObject } from 'shared';
import { historyArchiveObjectTypes } from 'history-scanner-dto';
import type { HistoryArchiveObjectJobDTO } from '../../domain/scan/ScanCoordinatorService.js';
import { CoordinatorServiceError } from './CoordinatorServiceError.js';

export function parseHistoryArchiveObjectJobDTO(
	response: unknown
): Result<HistoryArchiveObjectJobDTO, Error> {
	if (!isObject(response)) {
		return err(
			new CoordinatorServiceError(
				'History archive object job JSON must be an object'
			)
		);
	}

	if (
		typeof response.archiveUrl !== 'string' ||
		typeof response.claimAttempt !== 'number' ||
		!Number.isSafeInteger(response.claimAttempt) ||
		typeof response.objectKey !== 'string' ||
		!isHistoryArchiveObjectType(response.objectType) ||
		typeof response.objectUrl !== 'string' ||
		typeof response.remoteId !== 'string'
	) {
		return err(
			new CoordinatorServiceError(
				'Invalid history archive object job response format'
			)
		);
	}

	const checkpointLedger = response.checkpointLedger;
	if (
		checkpointLedger !== null &&
		checkpointLedger !== undefined &&
		(typeof checkpointLedger !== 'number' ||
			!Number.isSafeInteger(checkpointLedger))
	) {
		return err(
			new CoordinatorServiceError(
				'Invalid history archive object checkpoint ledger'
			)
		);
	}

	const bucketHash = response.bucketHash;
	if (
		bucketHash !== null &&
		bucketHash !== undefined &&
		typeof bucketHash !== 'string'
	) {
		return err(
			new CoordinatorServiceError('Invalid history archive object bucket hash')
		);
	}

	return ok({
		archiveUrl: response.archiveUrl,
		bucketHash: bucketHash ?? null,
		checkpointLedger: checkpointLedger ?? null,
		claimAttempt: response.claimAttempt,
		objectKey: response.objectKey,
		objectType: response.objectType,
		objectUrl: response.objectUrl,
		remoteId: response.remoteId
	});
}

function isHistoryArchiveObjectType(
	value: unknown
): value is (typeof historyArchiveObjectTypes)[number] {
	return (
		typeof value === 'string' &&
		historyArchiveObjectTypes.includes(
			value as (typeof historyArchiveObjectTypes)[number]
		)
	);
}
