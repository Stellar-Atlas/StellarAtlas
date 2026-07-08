import type { Repository } from 'typeorm';
import {
	ParsedTransactionEnvelopeBatchDTO,
	ParsedTransactionResultBatchDTO
} from 'history-scanner-dto';
import { ParsedTransactionEnvelope } from '../../../database/entities/ParsedTransactionEnvelope.js';
import { ParsedTransactionResult } from '../../../database/entities/ParsedTransactionResult.js';
import { TypeOrmParsedTransactionEnvelopeRepository } from '../TypeOrmParsedTransactionEnvelopeRepository.js';
import { TypeOrmParsedTransactionResultRepository } from '../TypeOrmParsedTransactionResultRepository.js';

describe('TypeOrmParsedTransactionEnvelopeRepository', () => {
	it('should upsert transaction envelopes by ledger, tx-set hash, and index', async () => {
		const builder = createInsertBuilder();
		const repository = {
			createQueryBuilder: jest.fn(() => builder)
		} as unknown as Repository<ParsedTransactionEnvelope>;
		const parsedRepository = new TypeOrmParsedTransactionEnvelopeRepository(
			repository
		);

		await parsedRepository.saveBatch(
			new ParsedTransactionEnvelopeBatchDTO(
				'https://archive-a.example',
				'job-a',
				new Date('2026-07-07T19:30:00.000Z'),
				[
					{
						envelopeXdr: 'AAAA-envelope',
						ledgerSequence: 63355967,
						transactionIndex: 4,
						transactionSetHash: 'transaction-set-hash'
					}
				]
			)
		);

		expect(builder.values).toHaveBeenCalledWith([
			expect.objectContaining({
				envelopeXdr: 'AAAA-envelope',
				ledgerSequence: 63355967,
				transactionIndex: 4,
				transactionSetHash: 'transaction-set-hash'
			})
		]);
		expect(builder.orUpdate).toHaveBeenCalledWith(
			['lastSourceArchiveUrl', 'lastScanJobRemoteId', 'lastSeenAt'],
			['ledgerSequence', 'transactionSetHash', 'transactionIndex'],
			{ skipUpdateIfNoValuesChanged: true }
		);
	});

	it('should ignore empty envelope batches', async () => {
		const repository = {
			createQueryBuilder: jest.fn()
		} as unknown as Repository<ParsedTransactionEnvelope>;
		const parsedRepository = new TypeOrmParsedTransactionEnvelopeRepository(
			repository
		);

		await parsedRepository.saveBatch(
			new ParsedTransactionEnvelopeBatchDTO(
				'https://archive-a.example',
				'job-a',
				new Date('2026-07-07T19:30:00.000Z'),
				[]
			)
		);

		expect(repository.createQueryBuilder).not.toHaveBeenCalled();
	});

	it('should find an envelope by ledger transaction identity', async () => {
		const repository = {
			find: jest.fn().mockResolvedValueOnce([
				{
					envelopeXdr: 'AAAA-envelope',
					lastSourceArchiveUrl: 'https://archive-a.example',
					ledgerSequence: 63355967,
					transactionIndex: 4,
					transactionSetHash: 'transaction-set-hash'
				}
			])
		} as unknown as Repository<ParsedTransactionEnvelope>;
		const parsedRepository = new TypeOrmParsedTransactionEnvelopeRepository(
			repository
		);

		await expect(
			parsedRepository.findByLedgerTransaction(
				63355967,
				'transaction-set-hash',
				4
			)
		).resolves.toEqual({
			envelopeXdr: 'AAAA-envelope',
			lastSourceArchiveUrl: 'https://archive-a.example',
			ledgerSequence: 63355967,
			transactionIndex: 4,
			transactionSetHash: 'transaction-set-hash'
		});
	});
});

describe('TypeOrmParsedTransactionResultRepository', () => {
	it('should upsert transaction results by ledger, result hash, and index', async () => {
		const builder = createInsertBuilder();
		const repository = {
			createQueryBuilder: jest.fn(() => builder)
		} as unknown as Repository<ParsedTransactionResult>;
		const parsedRepository = new TypeOrmParsedTransactionResultRepository(
			repository
		);

		await parsedRepository.saveBatch(
			new ParsedTransactionResultBatchDTO(
				'https://archive-a.example',
				'job-a',
				new Date('2026-07-07T19:30:00.000Z'),
				[
					{
						ledgerSequence: 63355967,
						resultXdr: 'AAAA-result',
						transactionHash: 'transaction-hash',
						transactionIndex: 4,
						transactionResultHash: 'transaction-result-hash'
					}
				]
			)
		);

		expect(builder.values).toHaveBeenCalledWith([
			expect.objectContaining({
				ledgerSequence: 63355967,
				transactionHash: 'transaction-hash',
				transactionIndex: 4,
				transactionResultHash: 'transaction-result-hash'
			})
		]);
		expect(builder.orUpdate).toHaveBeenCalledWith(
			['lastSourceArchiveUrl', 'lastScanJobRemoteId', 'lastSeenAt'],
			['ledgerSequence', 'transactionResultHash', 'transactionIndex'],
			{ skipUpdateIfNoValuesChanged: true }
		);
	});

	it('should ignore empty result batches', async () => {
		const repository = {
			createQueryBuilder: jest.fn()
		} as unknown as Repository<ParsedTransactionResult>;
		const parsedRepository = new TypeOrmParsedTransactionResultRepository(
			repository
		);

		await parsedRepository.saveBatch(
			new ParsedTransactionResultBatchDTO(
				'https://archive-a.example',
				'job-a',
				new Date('2026-07-07T19:30:00.000Z'),
				[]
			)
		);

		expect(repository.createQueryBuilder).not.toHaveBeenCalled();
	});

	it('should find a result by transaction hash', async () => {
		const repository = {
			find: jest.fn().mockResolvedValueOnce([
				{
					lastSourceArchiveUrl: 'https://archive-a.example',
					ledgerSequence: 63355967,
					resultXdr: 'AAAA-result',
					transactionHash: 'transaction-hash',
					transactionIndex: 4,
					transactionResultHash: 'transaction-result-hash'
				}
			])
		} as unknown as Repository<ParsedTransactionResult>;
		const parsedRepository = new TypeOrmParsedTransactionResultRepository(
			repository
		);

		await expect(
			parsedRepository.findByTransactionHash('transaction-hash')
		).resolves.toEqual({
			lastSourceArchiveUrl: 'https://archive-a.example',
			ledgerSequence: 63355967,
			resultXdr: 'AAAA-result',
			transactionHash: 'transaction-hash',
			transactionIndex: 4,
			transactionResultHash: 'transaction-result-hash'
		});
	});

	it('should find recent transaction results with ledger and envelope context', async () => {
		const repository = {
			query: jest.fn().mockResolvedValueOnce([
				{
					envelopeObservedAt: '2026-07-07T19:34:00.000Z',
					envelopeSourceArchiveUrl: 'https://archive-envelope.example',
					headerObservedAt: '2026-07-07T19:33:00.000Z',
					headerSourceArchiveUrl: 'https://archive-header.example',
					ledgerHeaderHash: 'ledger-header-hash',
					ledgerSequence: '63355967',
					protocolVersion: '27',
					resultObservedAt: '2026-07-07T19:35:00.000Z',
					resultSourceArchiveUrl: 'https://archive-result.example',
					transactionHash: 'transaction-hash',
					transactionIndex: '4',
					transactionResultHash: 'transaction-result-hash',
					transactionSetHash: 'transaction-set-hash'
				}
			])
		} as unknown as Repository<ParsedTransactionResult>;
		const parsedRepository = new TypeOrmParsedTransactionResultRepository(
			repository
		);

		await expect(
			parsedRepository.findRecentWithLedgerContext(5)
		).resolves.toEqual([
			{
				envelopeObservedAt: new Date('2026-07-07T19:34:00.000Z'),
				envelopeSourceArchiveUrl: 'https://archive-envelope.example',
				headerObservedAt: new Date('2026-07-07T19:33:00.000Z'),
				headerSourceArchiveUrl: 'https://archive-header.example',
				ledgerHeaderHash: 'ledger-header-hash',
				ledgerSequence: 63355967,
				protocolVersion: 27,
				resultObservedAt: new Date('2026-07-07T19:35:00.000Z'),
				resultSourceArchiveUrl: 'https://archive-result.example',
				transactionHash: 'transaction-hash',
				transactionIndex: 4,
				transactionResultHash: 'transaction-result-hash',
				transactionSetHash: 'transaction-set-hash'
			}
		]);
		expect(repository.query).toHaveBeenCalledWith(
			expect.stringContaining('from parsed_transaction_result tx_result'),
			[5]
		);
	});
});

function createInsertBuilder() {
	const builder = {
		execute: jest.fn(async () => undefined),
		insert: jest.fn(),
		into: jest.fn(),
		orUpdate: jest.fn(),
		values: jest.fn()
	};
	builder.insert.mockReturnValue(builder);
	builder.into.mockReturnValue(builder);
	builder.values.mockReturnValue(builder);
	builder.orUpdate.mockReturnValue(builder);

	return builder;
}
