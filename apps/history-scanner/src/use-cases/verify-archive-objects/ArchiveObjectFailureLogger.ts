import type { Logger } from 'logger';
import type { HistoryArchiveObjectFailureDTO } from '../../domain/scan/ScanCoordinatorService.js';

export function logArchiveObjectFailure(
	logger: Logger,
	remoteId: string,
	failure: HistoryArchiveObjectFailureDTO
): void {
	const context = {
		errorMessage: failure.errorMessage,
		errorType: failure.errorType,
		httpStatus: failure.httpStatus ?? null,
		remoteId
	};
	if (failure.failureChannel === 'scanner_issue') {
		logger.error('History archive scanner failed locally', context);
		return;
	}
	if (failure.failureChannel === 'archive_availability') {
		logger.warn(
			'Remote history archive object is temporarily unavailable',
			context
		);
		return;
	}
	logger.warn('History archive object failed integrity verification', context);
}
