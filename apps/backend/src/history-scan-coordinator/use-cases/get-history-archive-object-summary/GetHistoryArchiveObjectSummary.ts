import 'reflect-metadata';
import { inject, injectable } from 'inversify';
import { err, ok, Result } from 'neverthrow';
import type { HistoryArchiveObjectSummaryV1 } from 'shared';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';
import type { HistoryArchiveObjectRepository } from '../../domain/history-archive-object/HistoryArchiveObjectRepository.js';
import { TYPES } from '../../infrastructure/di/di-types.js';
import { InvalidUrlError } from '../get-latest-scan/InvalidUrlError.js';
import { Url } from '@core/domain/Url.js';
import { getHistoryArchiveUrlIdentity } from '../../domain/ArchiveUrlIdentity.js';

@injectable()
export class GetHistoryArchiveObjectSummary {
	constructor(
		@inject(TYPES.HistoryArchiveObjectRepository)
		private readonly objectRepository: HistoryArchiveObjectRepository,
		@inject('ExceptionLogger') private readonly exceptionLogger: ExceptionLogger
	) {}

	async execute(
		options: { readonly url?: string } = {}
	): Promise<Result<HistoryArchiveObjectSummaryV1, Error>> {
		if (options.url !== undefined && Url.create(options.url).isErr()) {
			return err(new InvalidUrlError(options.url));
		}

		try {
			const archiveUrlIdentity =
				options.url === undefined
					? null
					: getHistoryArchiveUrlIdentity(options.url);
			if (options.url !== undefined && archiveUrlIdentity === null) {
				return err(new InvalidUrlError(options.url));
			}

			const summary = await this.objectRepository.getSummary({
				archiveUrl: options.url ?? null,
				archiveUrlIdentity
			});

			return ok(summary);
		} catch (e) {
			const error = mapUnknownToError(e);
			this.exceptionLogger.captureException(error);
			return err(error);
		}
	}
}
