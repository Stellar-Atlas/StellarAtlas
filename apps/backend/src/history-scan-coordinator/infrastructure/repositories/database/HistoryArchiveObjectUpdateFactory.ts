import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity.js';
import type { HistoryArchiveObject } from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveObject.js';
import type {
	HistoryArchiveObjectFailure,
	HistoryArchiveObjectProgressUpdate
} from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveObjectRepository.js';

export function createActiveUpdate(
	progress?: HistoryArchiveObjectProgressUpdate
): QueryDeepPartialEntity<HistoryArchiveObject> {
	return {
		...createProgressUpdate(progress),
		updatedAt: () => 'now()'
	};
}

export function createVerifiedUpdate(
	progress?: HistoryArchiveObjectProgressUpdate
): QueryDeepPartialEntity<HistoryArchiveObject> {
	return {
		...createProgressUpdate(progress),
		claimedAt: null,
		claimedByCommunityScannerId: null,
		completionArchiveMetadata: progress?.archiveMetadata ?? null,
		errorMessage: null,
		errorType: null,
		failureChannel: null,
		httpStatus: null,
		nextAttemptAt: null,
		refreshAfter: () => rootHistoryArchiveStateRefreshSql(),
		status: 'verified',
		transitionEffectsCompletedAt: null,
		transitionEffectsRequiredAt: () => 'now()',
		updatedAt: () => 'now()',
		verifiedAt: () => 'now()',
		workerStage: progress?.workerStage ?? 'verified'
	};
}

export function createFailedUpdate(
	failure: HistoryArchiveObjectFailure
): QueryDeepPartialEntity<HistoryArchiveObject> {
	return {
		claimedAt: null,
		claimedByCommunityScannerId: null,
		completionArchiveMetadata: null,
		errorMessage: failure.errorMessage,
		errorType: failure.errorType,
		failureChannel: failure.failureChannel,
		httpStatus: failure.httpStatus ?? null,
		nextAttemptAt:
			failure.nextAttemptAt === undefined
				? () => "now() + interval '1 hour'"
				: failure.nextAttemptAt,
		status: 'failed',
		transitionEffectsCompletedAt: null,
		transitionEffectsRequiredAt: () => 'now()',
		updatedAt: () => 'now()',
		workerStage: 'failed',
		...(failure.verificationFacts === undefined
			? {}
			: { verificationFacts: failure.verificationFacts })
	};
}

export function createProgressUpdate(
	progress?: HistoryArchiveObjectProgressUpdate
): QueryDeepPartialEntity<HistoryArchiveObject> {
	const update: QueryDeepPartialEntity<HistoryArchiveObject> = {};
	if (progress === undefined) return update;

	if (progress.bytesDownloaded !== undefined) {
		update.bytesDownloaded = progress.bytesDownloaded;
	}
	if (progress.verificationFacts !== undefined) {
		update.verificationFacts = progress.verificationFacts;
	}
	if (progress.workerStage !== undefined) {
		update.workerStage = progress.workerStage;
	}

	return update;
}

function rootHistoryArchiveStateRefreshSql(): string {
	return `
		case
			when "objectType" = 'history-archive-state'
				and "objectKey" = 'root'
			then now() + interval '5 minutes'
			else "refreshAfter"
		end
	`;
}
