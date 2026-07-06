import 'reflect-metadata';
import { inject, injectable } from 'inversify';
import { err, ok, Result } from 'neverthrow';
import type { HistoryArchiveObjectFailure } from '../../domain/history-archive-object/HistoryArchiveObjectRepository.js';
import type { HistoryArchiveObjectRepository } from '../../domain/history-archive-object/HistoryArchiveObjectRepository.js';
import { TYPES } from '../../infrastructure/di/di-types.js';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';

@injectable()
export class FailHistoryArchiveObject {
	constructor(
		@inject(TYPES.HistoryArchiveObjectRepository)
		private readonly objectRepository: HistoryArchiveObjectRepository
	) {}

	async execute(
		remoteId: string,
		failure: HistoryArchiveObjectFailure
	): Promise<Result<boolean, Error>> {
		try {
			return ok(await this.objectRepository.markObjectFailed(remoteId, failure));
		} catch (e) {
			return err(mapUnknownToError(e));
		}
	}
}
