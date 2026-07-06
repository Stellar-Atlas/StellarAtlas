import 'reflect-metadata';
import { inject, injectable } from 'inversify';
import { err, ok, Result } from 'neverthrow';
import type { HistoryArchiveObjectEventsV1 } from 'shared';
import { getHistoryArchiveUrlIdentity } from '../../domain/ArchiveUrlIdentity.js';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';
import type { HistoryArchiveObjectEventRepository } from '../../domain/history-archive-object/HistoryArchiveObjectEventRepository.js';
import { TYPES } from '../../infrastructure/di/di-types.js';
import { InvalidUrlError } from '../get-latest-scan/InvalidUrlError.js';
import { Url } from '@core/domain/Url.js';
import { mapHistoryArchiveObjectEvents } from '../../infrastructure/mappers/mapHistoryArchiveObjectEvent.js';

const defaultEventLimit = 250;
const maxEventLimit = 5000;

@injectable()
export class GetHistoryArchiveObjectEvents {
	constructor(
		@inject(TYPES.HistoryArchiveObjectEventRepository)
		private readonly eventRepository: HistoryArchiveObjectEventRepository,
		@inject('ExceptionLogger') private readonly exceptionLogger: ExceptionLogger
	) {}

	async execute(
		options: { readonly limit?: number; readonly url?: string } = {}
	): Promise<Result<HistoryArchiveObjectEventsV1, Error>> {
		const archiveUrlIdentityOrError = getArchiveUrlIdentity(options.url);
		if (archiveUrlIdentityOrError.isErr()) return err(archiveUrlIdentityOrError.error);

		try {
			const page = await this.eventRepository.findRecent({
				archiveUrlIdentity: archiveUrlIdentityOrError.value,
				limit: normalizeLimit(options.limit)
			});

			return ok(mapHistoryArchiveObjectEvents(page, new Date()));
		} catch (e) {
			const error = mapUnknownToError(e);
			this.exceptionLogger.captureException(error);
			return err(error);
		}
	}
}

function getArchiveUrlIdentity(
	url: string | undefined
): Result<string | undefined, InvalidUrlError> {
	if (url === undefined) return ok(undefined);
	const urlOrError = Url.create(url);
	if (urlOrError.isErr()) return err(new InvalidUrlError(url));

	const archiveUrlIdentity = getHistoryArchiveUrlIdentity(urlOrError.value.value);
	if (archiveUrlIdentity === null) return err(new InvalidUrlError(url));

	return ok(archiveUrlIdentity);
}

function normalizeLimit(limit: number | undefined): number {
	if (limit === undefined || !Number.isSafeInteger(limit) || limit < 1) {
		return defaultEventLimit;
	}

	return Math.min(limit, maxEventLimit);
}
