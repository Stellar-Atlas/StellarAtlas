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
