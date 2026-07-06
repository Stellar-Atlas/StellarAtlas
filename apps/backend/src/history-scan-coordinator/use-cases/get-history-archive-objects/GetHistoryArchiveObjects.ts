import 'reflect-metadata';
import { inject, injectable } from 'inversify';
import { err, ok, Result } from 'neverthrow';
import type { HistoryArchiveObjectQueueV1 } from 'shared';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';
import type { HistoryArchiveObjectRepository } from '../../domain/history-archive-object/HistoryArchiveObjectRepository.js';
import { TYPES } from '../../infrastructure/di/di-types.js';
import { InvalidUrlError } from '../get-latest-scan/InvalidUrlError.js';
import { Url } from '@core/domain/Url.js';
import { mapHistoryArchiveObjectQueue } from '../../infrastructure/mappers/mapHistoryArchiveObject.js';

const defaultObjectLimit = 250;
const maxObjectLimit = 5000;

@injectable()
export class GetHistoryArchiveObjects {
	constructor(
		@inject(TYPES.HistoryArchiveObjectRepository)
		private readonly objectRepository: HistoryArchiveObjectRepository,
		@inject('ExceptionLogger') private readonly exceptionLogger: ExceptionLogger
	) {}

	async execute(
		options: { readonly limit?: number; readonly url?: string } = {}
	): Promise<Result<HistoryArchiveObjectQueueV1, Error>> {
		if (options.url !== undefined && Url.create(options.url).isErr()) {
			return err(new InvalidUrlError(options.url));
		}

		try {
			const limit = normalizeLimit(options.limit);
			const snapshot =
				options.url === undefined
					? await this.objectRepository.getQueueSnapshot(limit)
					: await this.objectRepository.findByArchiveUrl(options.url, limit);

			return ok(mapHistoryArchiveObjectQueue(snapshot, new Date()));
		} catch (e) {
			const error = mapUnknownToError(e);
			this.exceptionLogger.captureException(error);
			return err(error);
		}
	}
}

function normalizeLimit(limit: number | undefined): number {
	if (limit === undefined || !Number.isSafeInteger(limit) || limit < 1) {
		return defaultObjectLimit;
	}

	return Math.min(limit, maxObjectLimit);
}
