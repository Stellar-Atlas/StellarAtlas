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

describe('TypeOrmParsedLedgerHeaderRepository adversarial cases', () => {
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

	it('rolls back every row when one identity conflicts', async () => {
		const repository = createRepository();
		await repository.saveBatch(batch([header(1_001)]));

		await expect(
			repository.saveBatch(
				batch(
					[
						header(1_002),
						header(1_001, {
							bucketListHash: 'conflicting-bucket-list-hash'
						})
					],
					{ archiveUrl: 'https://conflict.example', jobId: 'conflict-job' }
				)
			)
		).rejects.toMatchObject({ reason: 'stored-value-conflict' });

		await expect(
			dataSource
				.getRepository(ParsedLedgerHeader)
				.countBy({ ledgerSequence: 1_002 })
		).resolves.toBe(0);
		await expect(
			dataSource
				.getRepository(ParsedLedgerHeader)
				.countBy({ ledgerSequence: 1_001 })
		).resolves.toBe(1);
	});

	it('rejects duplicate batch identities before PostgreSQL cardinality failure', async () => {
		const repository = createRepository();
		const duplicate = header(2_001);

		await expect(
			repository.saveBatch(batch([duplicate, { ...duplicate }]))
		).rejects.toMatchObject({ reason: 'duplicate-batch-identity' });
		await expect(
			dataSource
				.getRepository(ParsedLedgerHeader)
				.countBy({ ledgerSequence: 2_001 })
		).resolves.toBe(0);
	});

	it('orders equal-time provenance independently of arrival order', async () => {
		const repository = createRepository();
		await saveSources(repository, 3_001, ['z.example', 'a.example']);
		await saveSources(repository, 3_002, ['a.example', 'z.example']);

		for (const ledgerSequence of [3_001, 3_002]) {
			await expect(
				repository.findByLedgerSequenceAndHash(
					ledgerSequence,
					`header-${ledgerSequence}`
				)
			).resolves.toMatchObject({
				closedAtScanJobRemoteId: 'a.example-job',
				closedAtSourceArchiveUrl: 'https://a.example',
				firstSourceArchiveUrl: 'https://a.example',
				lastScanJobRemoteId: 'z.example-job',
				lastSourceArchiveUrl: 'https://z.example'
			});
		}
	});

	it('uses exact parameterized hash identity and preserves uint32 maximum', async () => {
		const repository = createRepository();
		const ledgerSequence = 0xffff_ffff;
		const injectedHash = "header-' OR true --";
		await repository.saveBatch(
			batch([
				header(ledgerSequence, { ledgerHeaderHash: injectedHash }),
				header(ledgerSequence, { ledgerHeaderHash: 'competing-header-hash' })
			])
		);

		await expect(
			repository.findByLedgerSequenceAndHash(ledgerSequence, injectedHash)
		).resolves.toMatchObject({
			ledgerHeaderHash: injectedHash,
			ledgerSequence,
			previousLedgerHeaderHash: `previous-${ledgerSequence}`
		});
		await expect(
			repository.findByLedgerSequenceAndHash(
				ledgerSequence,
				'competing-header-hash'
			)
		).resolves.toMatchObject({ ledgerHeaderHash: 'competing-header-hash' });
	});

	function createRepository(): TypeOrmParsedLedgerHeaderRepository {
		return new TypeOrmParsedLedgerHeaderRepository(
			dataSource.getRepository(ParsedLedgerHeader)
		);
	}
});

async function saveSources(
	repository: TypeOrmParsedLedgerHeaderRepository,
	ledgerSequence: number,
	hosts: readonly string[]
): Promise<void> {
	for (const host of hosts) {
		await repository.saveBatch(
			batch([header(ledgerSequence)], {
				archiveUrl: `https://${host}`,
				jobId: `${host}-job`
			})
		);
	}
}

function batch(
	headers: readonly ParsedLedgerHeaderDTO[],
	options: {
		readonly archiveUrl?: string;
		readonly jobId?: string;
	} = {}
): ParsedLedgerHeaderBatchDTO {
	return new ParsedLedgerHeaderBatchDTO(
		options.archiveUrl ?? 'https://archive.example',
		options.jobId ?? 'job-1',
		new Date('2026-07-11T12:00:00.000Z'),
		headers
	);
}

function header(
	ledgerSequence: number,
	overrides: Partial<ParsedLedgerHeaderDTO> = {}
): ParsedLedgerHeaderDTO {
	return {
		bucketListHash: `buckets-${ledgerSequence}`,
		closedAt: '2026-07-11T11:59:59.000Z',
		ledgerHeaderHash: `header-${ledgerSequence}`,
		ledgerSequence,
		previousLedgerHeaderHash: `previous-${ledgerSequence}`,
		protocolVersion: 27,
		transactionResultHash: `results-${ledgerSequence}`,
		transactionSetHash: `transactions-${ledgerSequence}`,
		...overrides
	};
}
