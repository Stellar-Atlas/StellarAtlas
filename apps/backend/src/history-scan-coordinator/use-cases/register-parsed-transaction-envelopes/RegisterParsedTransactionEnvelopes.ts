import { inject, injectable } from 'inversify';
import { err, ok, Result } from 'neverthrow';
import type { ParsedTransactionEnvelopeBatchDTO } from 'history-scanner-dto';
import type { Logger } from 'logger';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';
import { TYPES } from '../../infrastructure/di/di-types.js';
import type { ParsedTransactionEnvelopeRepository } from '../../domain/parsed-history/ParsedTransactionEnvelopeRepository.js';

@injectable()
export class RegisterParsedTransactionEnvelopes {
	constructor(
		@inject(TYPES.ParsedTransactionEnvelopeRepository)
		private readonly repository: ParsedTransactionEnvelopeRepository,
		@inject('Logger') private readonly logger: Logger
	) {}

	async execute(
		dto: ParsedTransactionEnvelopeBatchDTO
	): Promise<Result<void, Error>> {
		try {
			await this.repository.saveBatch(dto);
			this.logger.debug('Parsed transaction envelopes registered', {
				count: dto.records.length,
				sourceArchiveUrl: dto.sourceArchiveUrl
			});
			return ok(undefined);
		} catch (error) {
			return err(mapUnknownToError(error));
		}
	}
}
