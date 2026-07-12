import 'reflect-metadata';
import { mock } from 'jest-mock-extended';
import type { Logger } from 'logger';
import { ParsedLedgerHeaderBatchDTO } from 'history-scanner-dto';
import { ParsedLedgerHeaderConflictError } from '../../../domain/parsed-history/ParsedLedgerHeaderConflictError.js';
import type { ParsedLedgerHeaderRepository } from '../../../domain/parsed-history/ParsedLedgerHeaderRepository.js';
import { RegisterParsedLedgerHeaders } from '../RegisterParsedLedgerHeaders.js';

describe('RegisterParsedLedgerHeaders', () => {
	it('returns repository conflicts without acknowledging registration', async () => {
		const repository = mock<ParsedLedgerHeaderRepository>();
		const logger = mock<Logger>();
		const conflict = new ParsedLedgerHeaderConflictError(
			'stored-value-conflict',
			[{ ledgerHeaderHash: 'header-hash', ledgerSequence: 64 }]
		);
		repository.saveBatch.mockRejectedValue(conflict);
		const register = new RegisterParsedLedgerHeaders(repository, logger);

		const result = await register.execute(batch());

		expect(result.isErr()).toBe(true);
		expect(result._unsafeUnwrapErr()).toBe(conflict);
		expect(logger.info).not.toHaveBeenCalled();
		expect(logger.error).toHaveBeenCalledWith(
			'Failed to register parsed ledger headers',
			expect.objectContaining({ error: conflict.message })
		);
	});

	it('acknowledges a fully persisted batch', async () => {
		const repository = mock<ParsedLedgerHeaderRepository>();
		const logger = mock<Logger>();
		const register = new RegisterParsedLedgerHeaders(repository, logger);

		const result = await register.execute(batch());

		expect(result.isOk()).toBe(true);
		expect(logger.info).toHaveBeenCalledWith(
			'Parsed ledger headers registered',
			expect.objectContaining({ count: 1 })
		);
		expect(logger.error).not.toHaveBeenCalled();
	});
});

function batch(): ParsedLedgerHeaderBatchDTO {
	return new ParsedLedgerHeaderBatchDTO(
		'https://archive.example',
		'job-1',
		new Date('2026-07-11T12:00:00.000Z'),
		[
			{
				bucketListHash: 'bucket-list-hash',
				closedAt: '2026-07-11T11:59:59.000Z',
				ledgerHeaderHash: 'header-hash',
				ledgerSequence: 64,
				previousLedgerHeaderHash: 'previous-header-hash',
				protocolVersion: 27,
				transactionResultHash: 'result-hash',
				transactionSetHash: 'transaction-hash'
			}
		]
	);
}
