import { DataSource } from 'typeorm';
import {
	ParsedTransactionEnvelopeBatchDTO,
	ParsedTransactionResultBatchDTO
} from 'history-scanner-dto';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import { ParsedLedgerHeader } from '../../../database/entities/ParsedLedgerHeader.js';
import { ParsedTransactionEnvelope } from '../../../database/entities/ParsedTransactionEnvelope.js';
import { ParsedTransactionResult } from '../../../database/entities/ParsedTransactionResult.js';
import { ParsedHistoryObservationMigration1784850000000 } from '../../../database/migrations/1784850000000-ParsedHistoryObservationMigration.js';
import { TypeOrmParsedTransactionEnvelopeRepository } from '../TypeOrmParsedTransactionEnvelopeRepository.js';
import { TypeOrmParsedTransactionResultRepository } from '../TypeOrmParsedTransactionResultRepository.js';

jest.setTimeout(60_000);

describe('parsed transaction provenance in PostgreSQL', () => {
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
		await runObservationMigration(dataSource);
	});

	afterAll(async () => {
		if (dataSource?.isInitialized) await dataSource.destroy();
		if (postgres !== undefined) await postgres.stop();
	});

	it('deduplicates envelope bytes while retaining each exact object observation', async () => {
		const repository = new TypeOrmParsedTransactionEnvelopeRepository(
			dataSource.getRepository(ParsedTransactionEnvelope)
		);
		await repository.saveBatch(envelopeBatch('object-a'));
		await repository.saveBatch(envelopeBatch('object-b'));

		await expect(
			dataSource.getRepository(ParsedTransactionEnvelope).count()
		).resolves.toBe(1);
		await expect(
			observationCount('parsed_transaction_envelope_observation')
		).resolves.toBe(2);
		await expect(
			repository.findBySourceObjectRemoteId('object-a')
		).resolves.toEqual([
			expect.objectContaining({ envelopeXdr: 'AAAA-envelope' })
		]);
		await expect(
			repository.findBySourceObjectRemoteId('object-b')
		).resolves.toEqual([
			expect.objectContaining({ envelopeXdr: 'AAAA-envelope' })
		]);
	});

	it('rolls back an immutable envelope conflict without false provenance', async () => {
		const repository = new TypeOrmParsedTransactionEnvelopeRepository(
			dataSource.getRepository(ParsedTransactionEnvelope)
		);
		await expect(
			repository.saveBatch(envelopeBatch('object-c', 'different-envelope'))
		).rejects.toMatchObject({
			name: 'ParsedTransactionConflictError',
			reason: 'stored-value-conflict'
		});

		await expect(
			repository.findBySourceObjectRemoteId('object-c')
		).resolves.toEqual([]);
		const canonical = await dataSource
			.getRepository(ParsedTransactionEnvelope)
			.findOneByOrFail({
				ledgerSequence: 63_355_967,
				transactionIndex: 4,
				transactionSetHash: 'transaction-set-hash'
			});
		expect(canonical.envelopeXdr).toBe('AAAA-envelope');
	});

	it('deduplicates result bytes and rejects a relabeled transaction', async () => {
		const repository = new TypeOrmParsedTransactionResultRepository(
			dataSource.getRepository(ParsedTransactionResult)
		);
		await repository.saveBatch(resultBatch('result-object-a'));
		await repository.saveBatch(resultBatch('result-object-b'));

		await expect(
			dataSource.getRepository(ParsedTransactionResult).count()
		).resolves.toBe(1);
		await expect(
			observationCount('parsed_transaction_result_observation')
		).resolves.toBe(2);

		await expect(
			repository.saveBatch(
				resultBatch('result-object-c', {
					transactionHash: 'different-transaction-hash'
				})
			)
		).rejects.toMatchObject({
			name: 'ParsedTransactionConflictError',
			reason: 'stored-value-conflict'
		});
		await expect(
			repository.findBySourceObjectRemoteId('result-object-c')
		).resolves.toEqual([]);
	});

	it('rolls back every row when one result in a mixed batch conflicts', async () => {
		const repository = new TypeOrmParsedTransactionResultRepository(
			dataSource.getRepository(ParsedTransactionResult)
		);
		const batch = resultBatch('result-object-mixed', {
			transactionHash: 'different-transaction-hash'
		});
		const newRecord = {
			...batch.records[0],
			ledgerSequence: 63_355_968,
			transactionHash: 'new-transaction-hash',
			transactionResultHash: 'new-result-hash'
		};

		await expect(
			repository.saveBatch(
				new ParsedTransactionResultBatchDTO(
					batch.sourceArchiveUrl,
					batch.scanJobRemoteId,
					batch.observedAt,
					[batch.records[0], newRecord]
				)
			)
		).rejects.toMatchObject({ reason: 'stored-value-conflict' });
		await expect(
			dataSource.getRepository(ParsedTransactionResult).countBy({
				ledgerSequence: 63_355_968
			})
		).resolves.toBe(0);
		await expect(
			repository.findBySourceObjectRemoteId('result-object-mixed')
		).resolves.toEqual([]);
	});

	async function observationCount(table: string): Promise<number> {
		if (!allowedObservationTables.has(table)) throw new Error('Invalid table');
		const rows = (await dataSource.query(
			`select count(*)::integer as count from "${table}"`
		)) as { readonly count: number }[];
		return rows[0]?.count ?? 0;
	}
});

const allowedObservationTables = new Set([
	'parsed_transaction_envelope_observation',
	'parsed_transaction_result_observation'
]);

async function runObservationMigration(dataSource: DataSource): Promise<void> {
	const queryRunner = dataSource.createQueryRunner();
	await queryRunner.connect();
	await queryRunner.startTransaction();
	try {
		await new ParsedHistoryObservationMigration1784850000000().up(queryRunner);
		await queryRunner.commitTransaction();
	} catch (error) {
		await queryRunner.rollbackTransaction();
		throw error;
	} finally {
		await queryRunner.release();
	}
}

function envelopeBatch(
	sourceObjectRemoteId: string,
	envelopeXdr = 'AAAA-envelope'
): ParsedTransactionEnvelopeBatchDTO {
	return new ParsedTransactionEnvelopeBatchDTO(
		'https://archive-a.example',
		sourceObjectRemoteId,
		new Date('2026-07-07T19:30:00.000Z'),
		[
			{
				envelopeXdr,
				ledgerSequence: 63_355_967,
				transactionIndex: 4,
				transactionSetHash: 'transaction-set-hash'
			}
		]
	);
}

function resultBatch(
	sourceObjectRemoteId: string,
	overrides: Partial<{
		readonly resultXdr: string;
		readonly transactionHash: string;
	}> = {}
): ParsedTransactionResultBatchDTO {
	return new ParsedTransactionResultBatchDTO(
		'https://archive-a.example',
		sourceObjectRemoteId,
		new Date('2026-07-07T19:30:00.000Z'),
		[
			{
				ledgerSequence: 63_355_967,
				resultXdr: overrides.resultXdr ?? 'AAAA-result',
				transactionHash: overrides.transactionHash ?? 'transaction-hash',
				transactionIndex: 4,
				transactionResultHash: 'transaction-result-hash'
			}
		]
	);
}
