import type { EntityManager, Repository } from 'typeorm';
import { ParsedLedgerHeaderBatchDTO } from 'history-scanner-dto';
import { ParsedLedgerHeaderConflictError } from '../../../../domain/parsed-history/ParsedLedgerHeaderConflictError.js';
import { ParsedLedgerHeader } from '../../../database/entities/ParsedLedgerHeader.js';
import { TypeOrmParsedLedgerHeaderRepository } from '../TypeOrmParsedLedgerHeaderRepository.js';

describe('TypeOrmParsedLedgerHeaderRepository', () => {
	it('should upsert ledger headers by sequence and hash', async () => {
		const harness = createRepositoryHarness([
			{
				id: 7,
				ledgerHeaderHash: 'ledger-header-hash',
				ledgerSequence: 63332922
			}
		]);
		const parsedHeaderRepository = new TypeOrmParsedLedgerHeaderRepository(
			harness.repository
		);

		await parsedHeaderRepository.saveBatch(
			new ParsedLedgerHeaderBatchDTO(
				'https://archive-a.example',
				'job-a',
				new Date('2026-07-05T01:42:51.000Z'),
				[
					{
						bucketListHash: 'bucket-list-hash',
						closedAt: '2026-07-05T01:42:50.000Z',
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

		expect(harness.transactionQuery).toHaveBeenCalledWith(
			expect.stringContaining('"closedAt" = coalesce('),
			expect.arrayContaining([
				63332922,
				'ledger-header-hash',
				new Date('2026-07-05T01:42:50.000Z'),
				'https://archive-a.example',
				'job-a'
			])
		);
		const sql = String(harness.transactionQuery.mock.calls[0]?.[0]);
		expect(sql).toContain('stored."closedAt", excluded."closedAt"');
		expect(sql).toContain('excluded."previousLedgerHeaderHash" =');
		expect(sql).toContain('excluded."lastSeenAt" > stored."lastSeenAt"');
		expect(sql).toContain(
			'returning "id", "ledgerSequence", "ledgerHeaderHash"'
		);
		expect(harness.transactionQuery).toHaveBeenNthCalledWith(
			2,
			expect.stringContaining('parsed_ledger_header_observation'),
			expect.arrayContaining([7, 'job-a'])
		);
		expect(harness.transaction).toHaveBeenCalledTimes(1);
	});

	it('should ignore empty batches', async () => {
		const harness = createRepositoryHarness([]);
		const parsedHeaderRepository = new TypeOrmParsedLedgerHeaderRepository(
			harness.repository
		);

		await parsedHeaderRepository.saveBatch(
			new ParsedLedgerHeaderBatchDTO(
				'https://archive-a.example',
				'job-a',
				new Date('2026-07-05T01:42:51.000Z'),
				[]
			)
		);

		expect(harness.transaction).not.toHaveBeenCalled();
	});

	it('should deterministically prefer a complete parsed header', async () => {
		const repository = {
			query: jest.fn().mockResolvedValueOnce([
				{
					bucketListHash: 'bucket-list-hash',
					closedAt: new Date('2026-07-05T01:42:50.000Z'),
					closedAtObservedAt: new Date('2026-07-05T01:42:51.000Z'),
					closedAtScanJobRemoteId: 'job-a',
					closedAtSourceArchiveUrl: 'https://archive-a.example',
					firstSeenAt: new Date('2026-07-05T01:42:51.000Z'),
					firstSourceArchiveUrl: 'https://archive-a.example',
					lastScanJobRemoteId: 'job-a',
					lastSeenAt: new Date('2026-07-05T01:42:51.000Z'),
					lastSourceArchiveUrl: 'https://archive-a.example',
					ledgerHeaderHash: 'ledger-header-hash',
					ledgerSequence: '64',
					previousLedgerHeaderHash: 'previous-ledger-header-hash',
					protocolVersion: 27,
					transactionResultHash: 'transaction-result-hash',
					transactionSetHash: 'transaction-set-hash'
				}
			])
		} as unknown as Repository<ParsedLedgerHeader>;
		const parsedHeaderRepository = new TypeOrmParsedLedgerHeaderRepository(
			repository
		);

		await expect(
			parsedHeaderRepository.findByLedgerSequence(64)
		).resolves.toEqual({
			bucketListHash: 'bucket-list-hash',
			closedAt: new Date('2026-07-05T01:42:50.000Z'),
			closedAtObservedAt: new Date('2026-07-05T01:42:51.000Z'),
			closedAtScanJobRemoteId: 'job-a',
			closedAtSourceArchiveUrl: 'https://archive-a.example',
			firstSeenAt: new Date('2026-07-05T01:42:51.000Z'),
			firstSourceArchiveUrl: 'https://archive-a.example',
			lastScanJobRemoteId: 'job-a',
			lastSeenAt: new Date('2026-07-05T01:42:51.000Z'),
			lastSourceArchiveUrl: 'https://archive-a.example',
			ledgerHeaderHash: 'ledger-header-hash',
			ledgerSequence: 64,
			previousLedgerHeaderHash: 'previous-ledger-header-hash',
			protocolVersion: 27,
			transactionResultHash: 'transaction-result-hash',
			transactionSetHash: 'transaction-set-hash'
		});
		expect(repository.query).toHaveBeenCalledWith(
			expect.stringContaining(
				'("closedAt" is null) asc,\n\t\t\t\t\t"lastSeenAt" desc,\n\t\t\t\t\t"ledgerHeaderHash" asc'
			),
			[64]
		);
	});

	it('should look up one exact proof-selected sequence and hash', async () => {
		const row = detailsRow({
			ledgerHeaderHash: "header-' OR true --",
			ledgerSequence: '64'
		});
		const repository = {
			query: jest.fn().mockResolvedValueOnce([row])
		} as unknown as Repository<ParsedLedgerHeader>;
		const parsedHeaderRepository = new TypeOrmParsedLedgerHeaderRepository(
			repository
		);

		await expect(
			parsedHeaderRepository.findByLedgerSequenceAndHash(
				64,
				"header-' OR true --"
			)
		).resolves.toMatchObject({
			ledgerHeaderHash: "header-' OR true --",
			ledgerSequence: 64,
			previousLedgerHeaderHash: 'previous-ledger-header-hash',
			lastScanJobRemoteId: 'job-a'
		});
		expect(repository.query).toHaveBeenCalledWith(
			expect.stringContaining(
				'where "ledgerSequence" = $1 and "ledgerHeaderHash" = $2'
			),
			[64, "header-' OR true --"]
		);
	});

	it('should read only headers associated with the exact source object', async () => {
		const repository = {
			query: jest.fn().mockResolvedValueOnce([detailsRow()])
		} as unknown as Repository<ParsedLedgerHeader>;
		const parsedHeaderRepository = new TypeOrmParsedLedgerHeaderRepository(
			repository
		);

		const observations =
			await parsedHeaderRepository.findBySourceObjectRemoteId('object-uuid');
		expect(observations).toEqual([
			{
				bucketListHash: 'bucket-list-hash',
				closedAt: new Date('2026-07-05T01:42:50.000Z'),
				ledgerHeaderHash: 'ledger-header-hash',
				ledgerSequence: 64,
				previousLedgerHeaderHash: 'previous-ledger-header-hash',
				protocolVersion: 27,
				transactionResultHash: 'transaction-result-hash',
				transactionSetHash: 'transaction-set-hash'
			}
		]);
		expect(observations[0]).not.toHaveProperty('lastSourceArchiveUrl');
		expect(repository.query).toHaveBeenCalledWith(
			expect.stringContaining('where observation."sourceObjectRemoteId" = $1'),
			['object-uuid']
		);
	});

	it('should fail explicitly when an upsert identity is not returned', async () => {
		const harness = createRepositoryHarness([]);
		const parsedHeaderRepository = new TypeOrmParsedLedgerHeaderRepository(
			harness.repository
		);

		await expect(
			parsedHeaderRepository.saveBatch(createBatch())
		).rejects.toMatchObject({
			name: 'ParsedLedgerHeaderConflictError',
			reason: 'stored-value-conflict'
		});
	});

	it('should reject duplicate identities before opening a transaction', async () => {
		const harness = createRepositoryHarness([]);
		const parsedHeaderRepository = new TypeOrmParsedLedgerHeaderRepository(
			harness.repository
		);
		const header = createHeader();

		await expect(
			parsedHeaderRepository.saveBatch(createBatch([header, { ...header }]))
		).rejects.toEqual(
			expect.objectContaining<Partial<ParsedLedgerHeaderConflictError>>({
				name: 'ParsedLedgerHeaderConflictError',
				reason: 'duplicate-batch-identity'
			})
		);
		expect(harness.transaction).not.toHaveBeenCalled();
	});

	it('should reject unsafe numeric lookup and limit values before SQL', async () => {
		const repository = {
			query: jest.fn()
		} as unknown as Repository<ParsedLedgerHeader>;
		const parsedHeaderRepository = new TypeOrmParsedLedgerHeaderRepository(
			repository
		);

		await expect(
			parsedHeaderRepository.findByLedgerSequence(0x1_0000_0000)
		).rejects.toThrow(RangeError);
		await expect(
			parsedHeaderRepository.findByLedgerSequenceAndHash(64, ' ')
		).rejects.toThrow('ledgerHeaderHash must not be empty');
		await expect(parsedHeaderRepository.findSourceRanges(1.5)).rejects.toThrow(
			RangeError
		);
		expect(repository.query).not.toHaveBeenCalled();
	});

	it('should reject constructor-bypassed unsafe batch integers', async () => {
		const harness = createRepositoryHarness([]);
		const parsedHeaderRepository = new TypeOrmParsedLedgerHeaderRepository(
			harness.repository
		);

		await expect(
			parsedHeaderRepository.saveBatch(
				createBatch([{ ...createHeader(), ledgerSequence: 0x1_0000_0000 }])
			)
		).rejects.toThrow(RangeError);
		expect(harness.transaction).not.toHaveBeenCalled();
	});

	it('should read parsed header ranges by source archive', async () => {
		const repository = {
			query: jest.fn().mockResolvedValueOnce([
				{
					archiveUrl: 'https://archive-a.example',
					earliestLedgerSequence: '1',
					latestLedgerSequence: '64',
					latestObservedAt: '2026-07-06T00:00:00.000Z',
					parsedLedgerCount: '2'
				}
			])
		} as unknown as Repository<ParsedLedgerHeader>;
		const parsedHeaderRepository = new TypeOrmParsedLedgerHeaderRepository(
			repository
		);

		await expect(parsedHeaderRepository.findSourceRanges(5)).resolves.toEqual([
			{
				archiveUrl: 'https://archive-a.example',
				earliestLedgerSequence: 1,
				latestLedgerSequence: 64,
				latestObservedAt: new Date('2026-07-06T00:00:00.000Z'),
				parsedLedgerCount: 2
			}
		]);
		expect(repository.query).toHaveBeenCalledWith(
			expect.stringContaining('from parsed_ledger_header'),
			[5]
		);
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
		expect(repository.query).toHaveBeenNthCalledWith(
			2,
			expect.stringContaining('from parsed_ledger_header')
		);
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

function createRepositoryHarness(
	returnedRows: readonly {
		readonly id: number;
		readonly ledgerHeaderHash: string;
		readonly ledgerSequence: number;
	}[]
): {
	readonly repository: Repository<ParsedLedgerHeader>;
	readonly transaction: jest.Mock;
	readonly transactionQuery: jest.Mock;
} {
	const transactionQuery = jest.fn(async () => returnedRows);
	const manager = { query: transactionQuery } as unknown as EntityManager;
	const transaction = jest.fn(
		async (run: (manager: EntityManager) => Promise<unknown>) => run(manager)
	);
	return {
		repository: {
			manager: { transaction }
		} as unknown as Repository<ParsedLedgerHeader>,
		transaction,
		transactionQuery
	};
}

function createBatch(
	headers: readonly ReturnType<typeof createHeader>[] = [createHeader()]
): ParsedLedgerHeaderBatchDTO {
	return new ParsedLedgerHeaderBatchDTO(
		'https://archive-a.example',
		'job-a',
		new Date('2026-07-05T01:42:51.000Z'),
		headers
	);
}

function createHeader() {
	return {
		bucketListHash: 'bucket-list-hash',
		closedAt: '2026-07-05T01:42:50.000Z',
		ledgerHeaderHash: 'ledger-header-hash',
		ledgerSequence: 63332922,
		previousLedgerHeaderHash: 'previous-ledger-header-hash',
		protocolVersion: 23,
		transactionResultHash: 'transaction-result-hash',
		transactionSetHash: 'transaction-set-hash'
	};
}

function detailsRow(overrides: Record<string, unknown> = {}) {
	return {
		bucketListHash: 'bucket-list-hash',
		closedAt: new Date('2026-07-05T01:42:50.000Z'),
		closedAtObservedAt: new Date('2026-07-05T01:42:51.000Z'),
		closedAtScanJobRemoteId: 'job-a',
		closedAtSourceArchiveUrl: 'https://archive-a.example',
		firstSeenAt: new Date('2026-07-05T01:42:51.000Z'),
		firstSourceArchiveUrl: 'https://archive-a.example',
		lastScanJobRemoteId: 'job-a',
		lastSeenAt: new Date('2026-07-05T01:42:51.000Z'),
		lastSourceArchiveUrl: 'https://archive-a.example',
		ledgerHeaderHash: 'ledger-header-hash',
		ledgerSequence: '64',
		previousLedgerHeaderHash: 'previous-ledger-header-hash',
		protocolVersion: 27,
		transactionResultHash: 'transaction-result-hash',
		transactionSetHash: 'transaction-set-hash',
		...overrides
	};
}
