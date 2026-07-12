import { inject, injectable } from 'inversify';
import { err, ok, Result } from 'neverthrow';
import type { ParsedTransactionResultBatchDTO } from 'history-scanner-dto';
import type { Logger } from 'logger';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';
import { TYPES } from '../../infrastructure/di/di-types.js';
import type { ParsedTransactionResultRepository } from '../../domain/parsed-history/ParsedTransactionResultRepository.js';

@injectable()
export class RegisterParsedTransactionResults {
	constructor(
		@inject(TYPES.ParsedTransactionResultRepository)
		private readonly repository: ParsedTransactionResultRepository,
		@inject('Logger') private readonly logger: Logger
	) {}

	async execute(
		dto: ParsedTransactionResultBatchDTO
	): Promise<Result<void, Error>> {
		try {
			await this.repository.saveBatch(dto);
			this.logger.debug('Parsed transaction results registered', {
				count: dto.records.length,
				sourceArchiveUrl: dto.sourceArchiveUrl
			});
			return ok(undefined);
		} catch (error) {
			return err(mapUnknownToError(error));
		}
	}
}
