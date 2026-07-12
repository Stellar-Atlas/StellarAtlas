import { DataSource } from 'typeorm';
import {
	ParsedLedgerHeaderBatchDTO,
	type ParsedLedgerHeaderDTO
} from 'history-scanner-dto';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import { ParsedLedgerHeader } from '../../../database/entities/ParsedLedgerHeader.js';
import { ParsedTransactionEnvelope } from '../../../database/entities/ParsedTransactionEnvelope.js';
import { ParsedTransactionResult } from '../../../database/entities/ParsedTransactionResult.js';
import { ParsedHistoryObservationMigration1784850000000 } from '../../../database/migrations/1784850000000-ParsedHistoryObservationMigration.js';
import { TypeOrmParsedLedgerHeaderRepository } from '../TypeOrmParsedLedgerHeaderRepository.js';

jest.setTimeout(60_000);

describe('TypeOrmParsedLedgerHeaderRepository in PostgreSQL', () => {
	let dataSource: DataSource;
	let postgres: DisposablePostgres;

	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		dataSource = new DataSource({
			dropSchema: true,
			entities: [
				ParsedLedgerHeader,
				ParsedTransactionEnvelope,
				ParsedTransactionResult
			],
			logging: false,
			synchronize: true,
			type: 'postgres',
			url: postgres.url
		});
		await dataSource.initialize();
		const queryRunner = dataSource.createQueryRunner();
		await queryRunner.connect();
		await queryRunner.startTransaction();
		try {
			await new ParsedHistoryObservationMigration1784850000000().up(
				queryRunner
			);
			await queryRunner.commitTransaction();
		} catch (error) {
			await queryRunner.rollbackTransaction();
			throw error;
		} finally {
			await queryRunner.release();
		}
	});

	afterAll(async () => {
		if (dataSource?.isInitialized) await dataSource.destroy();
		if (postgres !== undefined) await postgres.stop();
	});

	it('preserves known close time while advancing newer observation metadata', async () => {
		const repository = new TypeOrmParsedLedgerHeaderRepository(
			dataSource.getRepository(ParsedLedgerHeader)
		);
		await repository.saveBatch(
			batch(
				'https://archive-a.example',
				'job-a',
				'2026-07-05T01:42:51.000Z',
				'2026-07-05T01:42:50.000Z'
			)
		);
		await repository.saveBatch(
			batch('https://archive-b.example', 'job-b', '2026-07-06T01:42:51.000Z')
		);

		const row = await dataSource
			.getRepository(ParsedLedgerHeader)
			.findOneByOrFail({
				ledgerHeaderHash: 'ledger-header-hash',
				ledgerSequence: 63332922
			});
		expect(row.closedAt).toEqual(new Date('2026-07-05T01:42:50.000Z'));
		expect(row.lastSeenAt).toEqual(new Date('2026-07-06T01:42:51.000Z'));
		expect(row.lastSourceArchiveUrl).toBe('https://archive-b.example');
		expect(row.lastScanJobRemoteId).toBe('job-b');
		expect(row.closedAtSourceArchiveUrl).toBe('https://archive-a.example');
		expect(row.closedAtScanJobRemoteId).toBe('job-a');
		expect(row.closedAtObservedAt).toEqual(
			new Date('2026-07-05T01:42:51.000Z')
		);
	});

	it('fills a legacy null close time from a later complete observation', async () => {
		const repository = new TypeOrmParsedLedgerHeaderRepository(
			dataSource.getRepository(ParsedLedgerHeader)
		);
		await repository.saveBatch(
			batch(
				'https://archive-a.example',
				'job-c',
				'2026-07-07T01:42:51.000Z',
				undefined,
				63332923
			)
		);
		await repository.saveBatch(
			batch(
				'https://archive-a.example',
				'job-d',
				'2026-07-08T01:42:51.000Z',
				'2026-07-05T01:42:55.000Z',
				63332923
			)
		);

		await expect(repository.findByLedgerSequence(63332923)).resolves.toEqual(
			expect.objectContaining({
				closedAt: new Date('2026-07-05T01:42:55.000Z'),
				closedAtObservedAt: new Date('2026-07-08T01:42:51.000Z'),
				closedAtScanJobRemoteId: 'job-d',
				closedAtSourceArchiveUrl: 'https://archive-a.example'
			})
		);
		await expect(
			repository.findBySourceObjectRemoteId('job-c')
		).resolves.toEqual([expect.objectContaining({ closedAt: null })]);
		await expect(
			repository.findBySourceObjectRemoteId('job-d')
		).resolves.toEqual([
			expect.objectContaining({
				closedAt: new Date('2026-07-05T01:42:55.000Z')
			})
		]);
	});

	it('rejects stale or identity-conflicting close-time observations', async () => {
		const repository = new TypeOrmParsedLedgerHeaderRepository(
			dataSource.getRepository(ParsedLedgerHeader)
		);
		const ledgerSequence = 63332924;
		await repository.saveBatch(
			batch(
				'https://canonical.example',
				'canonical-job',
				'2026-07-08T01:42:51.000Z',
				'2026-07-05T01:42:50.000Z',
				ledgerSequence
			)
		);
		await expect(
			repository.saveBatch(
				batch(
					'https://stale.example',
					'stale-job',
					'2026-07-07T01:42:51.000Z',
					'2026-07-05T01:42:49.000Z',
					ledgerSequence
				)
			)
		).rejects.toMatchObject({ reason: 'stored-value-conflict' });
		await expect(
			repository.saveBatch(
				batch(
					'https://conflict.example',
					'conflict-job',
					'2026-07-09T01:42:51.000Z',
					'2026-07-05T01:42:52.000Z',
					ledgerSequence
				)
			)
		).rejects.toMatchObject({ reason: 'stored-value-conflict' });
		await expect(
			repository.saveBatch(
				batch(
					'https://identity-conflict.example',
					'identity-conflict-job',
					'2026-07-10T01:42:51.000Z',
					'2026-07-05T01:42:50.000Z',
					ledgerSequence,
					{ bucketListHash: 'different-bucket-list-hash' }
				)
			)
		).rejects.toMatchObject({ reason: 'stored-value-conflict' });

		const row = await dataSource
			.getRepository(ParsedLedgerHeader)
			.findOneByOrFail({
				ledgerHeaderHash: 'ledger-header-hash',
				ledgerSequence
			});
		expect(row.closedAt).toEqual(new Date('2026-07-05T01:42:50.000Z'));
		expect(row.lastSeenAt).toEqual(new Date('2026-07-08T01:42:51.000Z'));
		expect(row.lastSourceArchiveUrl).toBe('https://canonical.example');
		expect(row.lastScanJobRemoteId).toBe('canonical-job');
	});

	it('selects one complete competing hash without borrowing another row', async () => {
		const repository = new TypeOrmParsedLedgerHeaderRepository(
			dataSource.getRepository(ParsedLedgerHeader)
		);
		const ledgerSequence = 63332925;
		await repository.saveBatch(
			batch(
				'https://complete.example',
				'complete-job',
				'2026-07-05T01:42:51.000Z',
				'2026-07-05T01:42:50.000Z',
				ledgerSequence,
				{
					bucketListHash: 'complete-bucket-list-hash',
					ledgerHeaderHash: 'complete-ledger-header-hash',
					transactionSetHash: 'complete-transaction-set-hash'
				}
			)
		);
		await repository.saveBatch(
			batch(
				'https://incomplete.example',
				'incomplete-job',
				'2026-07-10T01:42:51.000Z',
				undefined,
				ledgerSequence,
				{
					bucketListHash: 'incomplete-bucket-list-hash',
					ledgerHeaderHash: 'incomplete-ledger-header-hash',
					transactionSetHash: 'incomplete-transaction-set-hash'
				}
			)
		);

		await expect(
			repository.findByLedgerSequence(ledgerSequence)
		).resolves.toMatchObject({
			bucketListHash: 'complete-bucket-list-hash',
			closedAt: new Date('2026-07-05T01:42:50.000Z'),
			lastSourceArchiveUrl: 'https://complete.example',
			ledgerHeaderHash: 'complete-ledger-header-hash',
			protocolVersion: 27,
			transactionResultHash: 'transaction-result-hash',
			transactionSetHash: 'complete-transaction-set-hash'
		});
	});

	it('breaks equally complete staging ties by ledger header hash', async () => {
		const repository = new TypeOrmParsedLedgerHeaderRepository(
			dataSource.getRepository(ParsedLedgerHeader)
		);
		const ledgerSequence = 63332926;
		for (const ledgerHeaderHash of ['z-header-hash', 'a-header-hash']) {
			await repository.saveBatch(
				batch(
					`https://${ledgerHeaderHash}.example`,
					`${ledgerHeaderHash}-job`,
					'2026-07-11T01:42:51.000Z',
					'2026-07-11T01:42:50.000Z',
					ledgerSequence,
					{ ledgerHeaderHash }
				)
			);
		}

		await expect(
			repository.findByLedgerSequence(ledgerSequence)
		).resolves.toEqual(
			expect.objectContaining({ ledgerHeaderHash: 'a-header-hash' })
		);
	});

	it('returns null close time when every competing row is incomplete', async () => {
		const repository = new TypeOrmParsedLedgerHeaderRepository(
			dataSource.getRepository(ParsedLedgerHeader)
		);
		const ledgerSequence = 63332927;
		await repository.saveBatch(
			batch(
				'https://older-incomplete.example',
				'older-incomplete-job',
				'2026-07-10T01:42:51.000Z',
				undefined,
				ledgerSequence,
				{ ledgerHeaderHash: 'older-incomplete-hash' }
			)
		);
		await repository.saveBatch(
			batch(
				'https://newer-incomplete.example',
				'newer-incomplete-job',
				'2026-07-11T01:42:51.000Z',
				undefined,
				ledgerSequence,
				{ ledgerHeaderHash: 'newer-incomplete-hash' }
			)
		);

		await expect(
			repository.findByLedgerSequence(ledgerSequence)
		).resolves.toEqual(
			expect.objectContaining({
				closedAt: null,
				ledgerHeaderHash: 'newer-incomplete-hash'
			})
		);
	});

	it('deduplicates a header while retaining exact object associations', async () => {
		const repository = new TypeOrmParsedLedgerHeaderRepository(
			dataSource.getRepository(ParsedLedgerHeader)
		);
		const ledgerSequence = 63_332_928;
		await repository.saveBatch(
			batch(
				'https://archive-a.example',
				'header-object-a',
				'2026-07-11T01:42:51.000Z',
				'2026-07-11T01:42:50.000Z',
				ledgerSequence
			)
		);
		await repository.saveBatch(
			batch(
				'https://archive-b.example',
				'header-object-b',
				'2026-07-11T01:43:51.000Z',
				'2026-07-11T01:42:50.000Z',
				ledgerSequence
			)
		);

		await expect(
			repository.findBySourceObjectRemoteId('header-object-a')
		).resolves.toEqual([
			expect.objectContaining({
				ledgerSequence,
				ledgerHeaderHash: 'ledger-header-hash'
			})
		]);
		await expect(
			repository.findBySourceObjectRemoteId('header-object-b')
		).resolves.toEqual([
			expect.objectContaining({
				ledgerSequence,
				ledgerHeaderHash: 'ledger-header-hash'
			})
		]);
		const rows = (await dataSource.query(
			`select count(*)::integer as count
			 from parsed_ledger_header_observation
			 where "sourceObjectRemoteId" in ($1, $2)`,
			['header-object-a', 'header-object-b']
		)) as { readonly count: number }[];
		expect(rows[0]?.count).toBe(2);
	});
});

function batch(
	archiveUrl: string,
	jobId: string,
	observedAt: string,
	closedAt?: string,
	ledgerSequence = 63332922,
	overrides: Partial<ParsedLedgerHeaderDTO> = {}
): ParsedLedgerHeaderBatchDTO {
	return new ParsedLedgerHeaderBatchDTO(
		archiveUrl,
		jobId,
		new Date(observedAt),
		[
			{
				bucketListHash: 'bucket-list-hash',
				closedAt,
				ledgerHeaderHash: 'ledger-header-hash',
				ledgerSequence,
				previousLedgerHeaderHash: 'previous-ledger-header-hash',
				protocolVersion: 27,
				transactionResultHash: 'transaction-result-hash',
				transactionSetHash: 'transaction-set-hash',
				...overrides
			}
		]
	);
}
