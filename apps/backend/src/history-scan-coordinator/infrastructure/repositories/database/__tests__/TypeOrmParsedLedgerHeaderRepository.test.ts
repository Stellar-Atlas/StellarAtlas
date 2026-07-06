import type { Repository } from 'typeorm';
import { ParsedLedgerHeaderBatchDTO } from 'history-scanner-dto';
import { ParsedLedgerHeader } from '../../../database/entities/ParsedLedgerHeader.js';
import { TypeOrmParsedLedgerHeaderRepository } from '../TypeOrmParsedLedgerHeaderRepository.js';

describe('TypeOrmParsedLedgerHeaderRepository', () => {
	it('should upsert ledger headers by sequence and hash', async () => {
		const builder = createInsertBuilder();
		const repository = {
			createQueryBuilder: jest.fn(() => builder)
		} as unknown as Repository<ParsedLedgerHeader>;
		const parsedHeaderRepository = new TypeOrmParsedLedgerHeaderRepository(
			repository
		);

		await parsedHeaderRepository.saveBatch(
			new ParsedLedgerHeaderBatchDTO(
				'https://archive-a.example',
				'job-a',
				new Date('2026-07-05T01:42:51.000Z'),
				[
					{
						bucketListHash: 'bucket-list-hash',
						ledgerHeaderHash: 'ledger-header-hash',
						ledgerSequence: 63332922,
						previousLedgerHeaderHash: 'previous-ledger-header-hash',
						protocolVersion: 23,
						transactionResultHash: 'transaction-result-hash',
						transactionSetHash: 'transaction-set-hash'
					}
				]
			)
		);

		expect(builder.values).toHaveBeenCalledWith([
			expect.objectContaining({
				firstSourceArchiveUrl: 'https://archive-a.example',
				lastScanJobRemoteId: 'job-a',
				lastSourceArchiveUrl: 'https://archive-a.example',
				ledgerHeaderHash: 'ledger-header-hash',
				ledgerSequence: 63332922
			})
		]);
		expect(builder.orUpdate).toHaveBeenCalledWith(
			['lastSourceArchiveUrl', 'lastScanJobRemoteId', 'lastSeenAt'],
			['ledgerSequence', 'ledgerHeaderHash'],
			{ skipUpdateIfNoValuesChanged: true }
		);
		expect(builder.execute).toHaveBeenCalled();
	});

	it('should ignore empty batches', async () => {
		const builder = createInsertBuilder();
		const repository = {
			createQueryBuilder: jest.fn(() => builder)
		} as unknown as Repository<ParsedLedgerHeader>;
		const parsedHeaderRepository = new TypeOrmParsedLedgerHeaderRepository(
			repository
		);

		await parsedHeaderRepository.saveBatch(
			new ParsedLedgerHeaderBatchDTO(
				'https://archive-a.example',
				'job-a',
				new Date('2026-07-05T01:42:51.000Z'),
				[]
			)
		);

		expect(repository.createQueryBuilder).not.toHaveBeenCalled();
	});

	it('should read a parsed ledger header watermark', async () => {
		const repository = {
			find: jest
				.fn()
				.mockResolvedValueOnce([{ ledgerSequence: 64 }])
				.mockResolvedValueOnce([
					{
						lastSeenAt: new Date('2026-07-06T00:00:00.000Z'),
						ledgerHeaderHash: 'latest-header-hash',
						ledgerSequence: 128
					}
				]),
			query: jest
				.fn()
				.mockResolvedValueOnce([{ parsedLedgerCount: '2' }])
				.mockResolvedValueOnce([{ sourceArchiveCount: '1' }])
		} as unknown as Repository<ParsedLedgerHeader>;
		const parsedHeaderRepository = new TypeOrmParsedLedgerHeaderRepository(
			repository
		);

		await expect(parsedHeaderRepository.getWatermark()).resolves.toEqual({
			earliestLedgerSequence: 64,
			latestLedgerHeaderHash: 'latest-header-hash',
			latestLedgerSequence: 128,
			latestObservedAt: new Date('2026-07-06T00:00:00.000Z'),
			parsedLedgerCount: 2,
			sourceArchiveCount: 1
		});
		expect(repository.query).toHaveBeenCalledTimes(2);
		expect(repository.find).toHaveBeenNthCalledWith(1, {
			order: { ledgerSequence: 'ASC' },
			select: { ledgerSequence: true },
			take: 1
		});
		expect(repository.find).toHaveBeenNthCalledWith(2, {
			order: { ledgerSequence: 'DESC', lastSeenAt: 'DESC' },
			select: {
				lastSeenAt: true,
				ledgerHeaderHash: true,
				ledgerSequence: true
			},
			take: 1
		});
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
