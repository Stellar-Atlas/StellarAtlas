import 'reflect-metadata';
import { inject, injectable } from 'inversify';
import { err, ok, Result } from 'neverthrow';
import type { HistoryArchiveObjectRepository } from '../../domain/history-archive-object/HistoryArchiveObjectRepository.js';
import { TYPES } from '../../infrastructure/di/di-types.js';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';

@injectable()
export class ReleaseHistoryArchiveObject {
	constructor(
		@inject(TYPES.HistoryArchiveObjectRepository)
		private readonly objectRepository: HistoryArchiveObjectRepository
	) {}

	async execute(
		remoteId: string,
		claimAttempt: number
	): Promise<Result<boolean, Error>> {
		try {
			return ok(
				await this.objectRepository.releaseObject(remoteId, claimAttempt)
			);
		} catch (e) {
			return err(mapUnknownToError(e));
		}
	}
}
