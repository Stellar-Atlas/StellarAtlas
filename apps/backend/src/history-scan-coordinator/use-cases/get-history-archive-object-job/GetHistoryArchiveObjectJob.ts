import 'reflect-metadata';
import { inject, injectable } from 'inversify';
import { err, ok, Result } from 'neverthrow';
import type { Logger } from 'logger';
import type { HistoryArchiveObjectType } from '../../domain/history-archive-object/HistoryArchiveObject.js';
import type { HistoryArchiveObjectRepository } from '../../domain/history-archive-object/HistoryArchiveObjectRepository.js';
import { TYPES } from '../../infrastructure/di/di-types.js';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';
import { HistoryArchiveObjectEventRecorder } from '../record-history-archive-object-event/HistoryArchiveObjectEventRecorder.js';

export interface HistoryArchiveObjectJobDTO {
	readonly archiveUrl: string;
	readonly bucketHash: string | null;
	readonly checkpointLedger: number | null;
	readonly claimAttempt: number;
	readonly objectKey: string;
	readonly objectType: HistoryArchiveObjectType;
	readonly objectUrl: string;
	readonly remoteId: string;
}

const supportedObjectTypes: readonly HistoryArchiveObjectType[] = [
	'history-archive-state',
	'checkpoint-state',
	'ledger',
	'transactions',
	'results',
	'scp',
	'bucket'
];

@injectable()
export class GetHistoryArchiveObjectJob {
	constructor(
		@inject(TYPES.HistoryArchiveObjectRepository)
		private readonly objectRepository: HistoryArchiveObjectRepository,
		private readonly eventRecorder: HistoryArchiveObjectEventRecorder,
		@inject('Logger') private readonly logger: Logger
	) {}

	async execute(): Promise<Result<HistoryArchiveObjectJobDTO | null, Error>> {
		try {
			await this.objectRepository.releaseStaleObjects(getStaleObjectCutoff());
			const object =
				await this.objectRepository.claimNextObject(supportedObjectTypes);
			if (object === null) return ok(null);
			await this.eventRecorder.record(object, {
				claimAttempt: object.attempts,
				eventType: 'claimed'
			});

			return ok({
				archiveUrl: object.archiveUrl,
				bucketHash: object.bucketHash,
				checkpointLedger: object.checkpointLedger,
				claimAttempt: object.attempts,
				objectKey: object.objectKey,
				objectType: object.objectType,
				objectUrl: object.objectUrl,
				remoteId: object.remoteId
			});
		} catch (e) {
			const error = mapUnknownToError(e);
			this.logger.error('Failed to claim history archive object', {
				app: 'history-scan-coordinator',
				errorMessage: error.message
			});
			return err(error);
		}
	}
}

function getStaleObjectCutoff(): Date {
	return new Date(Date.now() - 2 * 60 * 1000);
}
