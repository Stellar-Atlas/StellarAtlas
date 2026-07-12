import { inject, injectable } from 'inversify';
import { err, ok, Result } from 'neverthrow';
import type { ParsedLedgerHeaderBatchDTO } from 'history-scanner-dto';
import type { Logger } from 'logger';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';
import { TYPES } from '../../infrastructure/di/di-types.js';
import type { ParsedLedgerHeaderRepository } from '../../domain/parsed-history/ParsedLedgerHeaderRepository.js';

@injectable()
export class RegisterParsedLedgerHeaders {
	constructor(
		@inject(TYPES.ParsedLedgerHeaderRepository)
		private readonly repository: ParsedLedgerHeaderRepository,
		@inject('Logger') private readonly logger: Logger
	) {}

	async execute(dto: ParsedLedgerHeaderBatchDTO): Promise<Result<void, Error>> {
		try {
			await this.repository.saveBatch(dto);
			this.logger.info('Parsed ledger headers registered', {
				count: dto.headers.length,
				sourceArchiveUrl: dto.sourceArchiveUrl
			});
			return ok(undefined);
		} catch (error) {
			const mappedError = mapUnknownToError(error);
			this.logger.error('Failed to register parsed ledger headers', {
				count: dto.headers.length,
				error: mappedError.message,
				sourceArchiveUrl: dto.sourceArchiveUrl
			});
			return err(mappedError);
		}
	}
}
