import type { EntityManager, Repository } from 'typeorm';
import {
	ParsedTransactionEnvelopeBatchDTO,
	ParsedTransactionResultBatchDTO
} from 'history-scanner-dto';
import { ParsedTransactionEnvelope } from '../../../database/entities/ParsedTransactionEnvelope.js';
import { ParsedTransactionResult } from '../../../database/entities/ParsedTransactionResult.js';
import { TypeOrmParsedTransactionEnvelopeRepository } from '../TypeOrmParsedTransactionEnvelopeRepository.js';
import { TypeOrmParsedTransactionResultRepository } from '../TypeOrmParsedTransactionResultRepository.js';

describe('TypeOrmParsedTransactionEnvelopeRepository', () => {
	it('should atomically upsert an envelope and its exact object observation', async () => {
		const harness = createTransactionHarness([
			{
				id: 12,
				ledgerSequence: '63355967',
				transactionIndex: 4,
				transactionSetHash: 'transaction-set-hash'
			}
		]);
		const parsedRepository = new TypeOrmParsedTransactionEnvelopeRepository(
			harness.repository as Repository<ParsedTransactionEnvelope>
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

		expect(harness.query).toHaveBeenNthCalledWith(
			1,
			expect.stringContaining(
				'where excluded."envelopeXdr" = stored."envelopeXdr"'
			),
			expect.arrayContaining(['AAAA-envelope', 'transaction-set-hash'])
		);
		expect(harness.query).toHaveBeenNthCalledWith(
			2,
			expect.stringContaining('parsed_transaction_envelope_observation'),
			expect.arrayContaining([12, 'job-a'])
		);
		expect(harness.transaction).toHaveBeenCalledTimes(1);
	});

	it('should ignore empty envelope batches', async () => {
		const harness = createTransactionHarness([]);
		const parsedRepository = new TypeOrmParsedTransactionEnvelopeRepository(
			harness.repository as Repository<ParsedTransactionEnvelope>
		);

		await parsedRepository.saveBatch(
			new ParsedTransactionEnvelopeBatchDTO(
				'https://archive-a.example',
				'job-a',
				new Date('2026-07-07T19:30:00.000Z'),
				[]
			)
		);

		expect(harness.transaction).not.toHaveBeenCalled();
	});

	it('should reject an immutable envelope conflict and skip provenance', async () => {
		const harness = createTransactionHarness([]);
		const parsedRepository = new TypeOrmParsedTransactionEnvelopeRepository(
			harness.repository as Repository<ParsedTransactionEnvelope>
		);

		await expect(
			parsedRepository.saveBatch(envelopeBatch())
		).rejects.toMatchObject({
			name: 'ParsedTransactionConflictError',
			reason: 'stored-value-conflict'
		});
		expect(harness.query).toHaveBeenCalledTimes(1);
	});

	it('should reject duplicate and out-of-range envelope rows before SQL', async () => {
		const harness = createTransactionHarness([]);
		const parsedRepository = new TypeOrmParsedTransactionEnvelopeRepository(
			harness.repository as Repository<ParsedTransactionEnvelope>
		);
		const batch = envelopeBatch();

		await expect(
			parsedRepository.saveBatch(
				new ParsedTransactionEnvelopeBatchDTO(
					batch.sourceArchiveUrl,
					batch.scanJobRemoteId,
					batch.observedAt,
					[batch.records[0], { ...batch.records[0] }]
				)
			)
		).rejects.toMatchObject({ reason: 'duplicate-batch-identity' });
		await expect(
			parsedRepository.saveBatch(
				new ParsedTransactionEnvelopeBatchDTO(
					batch.sourceArchiveUrl,
					batch.scanJobRemoteId,
					batch.observedAt,
					[{ ...batch.records[0], ledgerSequence: 0x1_0000_0000 }]
				)
			)
		).rejects.toThrow(RangeError);
		expect(harness.transaction).not.toHaveBeenCalled();
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

	it('should read envelopes through the exact source-object association', async () => {
		const repository = {
			query: jest.fn().mockResolvedValueOnce([
				{
					envelopeXdr: 'AAAA-envelope',
					lastSourceArchiveUrl: 'https://archive-a.example',
					ledgerSequence: '63355967',
					transactionIndex: '4',
					transactionSetHash: 'transaction-set-hash'
				}
			])
		} as unknown as Repository<ParsedTransactionEnvelope>;
		const parsedRepository = new TypeOrmParsedTransactionEnvelopeRepository(
			repository
		);

		await expect(
			parsedRepository.findBySourceObjectRemoteId('object-uuid')
		).resolves.toEqual([
			{
				envelopeXdr: 'AAAA-envelope',
				ledgerSequence: 63355967,
				transactionIndex: 4,
				transactionSetHash: 'transaction-set-hash'
			}
		]);
		expect(repository.query).toHaveBeenCalledWith(
			expect.stringContaining('parsed_transaction_envelope_observation'),
			['object-uuid']
		);
	});
});

describe('TypeOrmParsedTransactionResultRepository', () => {
	it('should atomically upsert a result and its exact object observation', async () => {
		const harness = createTransactionHarness([
			{
				id: 19,
				ledgerSequence: '63355967',
				transactionIndex: 4,
				transactionResultHash: 'transaction-result-hash'
			}
		]);
		const parsedRepository = new TypeOrmParsedTransactionResultRepository(
			harness.repository as Repository<ParsedTransactionResult>
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

		expect(harness.query).toHaveBeenNthCalledWith(
			1,
			expect.stringContaining(
				'where excluded."transactionHash" = stored."transactionHash"'
			),
			expect.arrayContaining(['AAAA-result', 'transaction-hash'])
		);
		expect(harness.query).toHaveBeenNthCalledWith(
			2,
			expect.stringContaining('parsed_transaction_result_observation'),
			expect.arrayContaining([19, 'job-a'])
		);
	});

	it('should ignore empty result batches', async () => {
		const harness = createTransactionHarness([]);
		const parsedRepository = new TypeOrmParsedTransactionResultRepository(
			harness.repository as Repository<ParsedTransactionResult>
		);

		await parsedRepository.saveBatch(
			new ParsedTransactionResultBatchDTO(
				'https://archive-a.example',
				'job-a',
				new Date('2026-07-07T19:30:00.000Z'),
				[]
			)
		);

		expect(harness.transaction).not.toHaveBeenCalled();
	});

	it('should reject an immutable result conflict and skip provenance', async () => {
		const harness = createTransactionHarness([]);
		const parsedRepository = new TypeOrmParsedTransactionResultRepository(
			harness.repository as Repository<ParsedTransactionResult>
		);

		await expect(
			parsedRepository.saveBatch(resultBatch())
		).rejects.toMatchObject({
			name: 'ParsedTransactionConflictError',
			reason: 'stored-value-conflict'
		});
		expect(harness.query).toHaveBeenCalledTimes(1);
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

	it('should read results through the exact source-object association', async () => {
		const repository = {
			query: jest.fn().mockResolvedValueOnce([
				{
					lastSourceArchiveUrl: 'https://archive-a.example',
					ledgerSequence: '63355967',
					resultXdr: 'AAAA-result',
					transactionHash: 'transaction-hash',
					transactionIndex: '4',
					transactionResultHash: 'transaction-result-hash'
				}
			])
		} as unknown as Repository<ParsedTransactionResult>;
		const parsedRepository = new TypeOrmParsedTransactionResultRepository(
			repository
		);

		await expect(
			parsedRepository.findBySourceObjectRemoteId('object-uuid')
		).resolves.toEqual([
			{
				ledgerSequence: 63355967,
				resultXdr: 'AAAA-result',
				transactionHash: 'transaction-hash',
				transactionIndex: 4,
				transactionResultHash: 'transaction-result-hash'
			}
		]);
		expect(repository.query).toHaveBeenCalledWith(
			expect.stringContaining('parsed_transaction_result_observation'),
			['object-uuid']
		);
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

function createTransactionHarness(returnedRows: readonly object[]): {
	readonly query: jest.Mock;
	readonly repository: Repository<ParsedTransactionEnvelope>;
	readonly transaction: jest.Mock;
} {
	const query = jest
		.fn()
		.mockResolvedValueOnce(returnedRows)
		.mockResolvedValueOnce([]);
	const transactionManager = { query } as unknown as EntityManager;
	const transaction = jest.fn(
		async (run: (manager: EntityManager) => Promise<unknown>) =>
			run(transactionManager)
	);
	return {
		query,
		repository: {
			manager: { transaction }
		} as unknown as Repository<ParsedTransactionEnvelope>,
		transaction
	};
}

function envelopeBatch(): ParsedTransactionEnvelopeBatchDTO {
	return new ParsedTransactionEnvelopeBatchDTO(
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
	);
}

function resultBatch(): ParsedTransactionResultBatchDTO {
	return new ParsedTransactionResultBatchDTO(
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
	);
}
