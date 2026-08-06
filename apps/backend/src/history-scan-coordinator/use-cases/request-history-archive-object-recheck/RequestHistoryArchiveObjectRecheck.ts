import 'reflect-metadata';
import { inject, injectable } from 'inversify';
import { err, ok, type Result } from 'neverthrow';
import type { HistoryArchiveObjectRecheckResponseV1 } from 'shared';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';
import type {
	HistoryArchiveObjectRecheckDecision,
	HistoryArchiveObjectRepository
} from '../../domain/history-archive-object/HistoryArchiveObjectRepository.js';
import { TYPES } from '../../infrastructure/di/di-types.js';

@injectable()
export class RequestHistoryArchiveObjectRecheck {
	constructor(
		@inject(TYPES.HistoryArchiveObjectRepository)
		private readonly objectRepository: HistoryArchiveObjectRepository,
		@inject('ExceptionLogger') private readonly exceptionLogger: ExceptionLogger
	) {}

	async execute(
		remoteId: string,
		minimumEvidenceUpdatedAt?: Date
	): Promise<Result<HistoryArchiveObjectRecheckResponseV1 | null, Error>> {
		try {
			const decision = await this.objectRepository.requestObjectRecheck(
				remoteId,
				minimumEvidenceUpdatedAt
			);
			return ok(decision === null ? null : toResponse(decision));
		} catch (error) {
			const mappedError = mapUnknownToError(error);
			this.exceptionLogger.captureException(mappedError);
			return err(mappedError);
		}
	}
}

function toResponse(
	decision: HistoryArchiveObjectRecheckDecision
): HistoryArchiveObjectRecheckResponseV1 {
	const base = {
		eligibleAt: decision.eligibleAt?.toISOString() ?? null,
		hostBackoffUntil: decision.blockedUntil?.toISOString() ?? null,
		remoteId: decision.remoteId
	};
	if (decision.state === 'queued') {
		return { ...base, reason: decision.reason, state: decision.state };
	}
	if (decision.state === 'already-queued') {
		return { ...base, reason: decision.reason, state: decision.state };
	}
	if (decision.state === 'not-yet-eligible') {
		return { ...base, reason: decision.reason, state: decision.state };
	}
	return { ...base, reason: decision.reason, state: decision.state };
}
