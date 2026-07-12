import { DataSource } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import { fullHistoryLedgerSequence } from '../../../../domain/full-history/FullHistoryCanonicalTypes.js';
import { TypeOrmFullHistoryCanonicalRepository } from '../TypeOrmFullHistoryCanonicalRepository.js';
import {
	fullHistoryEntities,
	installFullHistoryCanonicalSchema,
	seedFullHistoryCheckpoint
} from './FullHistoryCanonicalFixture.js';

jest.setTimeout(60_000);

describe('TypeOrmFullHistoryCanonicalRepository', () => {
	let dataSource: DataSource;
	let postgres: DisposablePostgres;
	let repository: TypeOrmFullHistoryCanonicalRepository;

	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		dataSource = new DataSource({
			entities: fullHistoryEntities,
			logging: false,
			synchronize: false,
			type: 'postgres',
			url: postgres.url
		});
		await dataSource.initialize();
		await installFullHistoryCanonicalSchema(dataSource);
		repository = new TypeOrmFullHistoryCanonicalRepository(dataSource);
	});

	afterAll(async () => {
		if (dataSource?.isInitialized) await dataSource.destroy();
		if (postgres !== undefined) await postgres.stop();
	});

	it('atomically persists the 63-row genesis checkpoint without copied XDR', async () => {
		const input = await seedFullHistoryCheckpoint(dataSource, {
			batchNumber: 1,
			feeBid: '9223372036854775807'
		});
		await expect(repository.writeCheckpoint(input)).resolves.toEqual({
			batchId: input.batchId,
			nextLedger: '64',
			replayed: false
		});

		await expect(
			repository.getWatermark(input.networkPassphrase)
		).resolves.toEqual(
			expect.objectContaining({
				lastBatchId: input.batchId,
				nextLedger: '64'
			})
		);
		const ledger = await repository.findLedger(
			input.networkPassphrase,
			fullHistoryLedgerSequence('1')
		);
		expect(ledger).toEqual(
			expect.objectContaining({
				ledgerSequence: '1',
				protocolVersion: 27,
				transactionCount: 1
			})
		);
		const transaction = await repository.findTransaction(
			input.networkPassphrase,
			input.transactions[0]!.transactionHash
		);
		expect(transaction).toEqual(
			expect.objectContaining({
				feeBid: '9223372036854775807',
				feeCharged: '100',
				ledgerSequence: '1',
				successful: true
			})
		);

		expect(await batchCounts(input.batchId)).toEqual({
			batches: 1,
			ledgers: 63,
			results: 1,
			transactions: 1
		});
		const lengths = (await dataSource.query(
			`
				select min(octet_length("ledger_hash"))::integer as minimum,
					max(octet_length("ledger_hash"))::integer as maximum
				from "full_history_ledger" where "batch_id" = $1
			`,
			[input.batchId]
		)) as Array<{ readonly maximum: number; readonly minimum: number }>;
		expect(lengths).toEqual([{ maximum: 32, minimum: 32 }]);
		const xdrColumns = await dataSource.query(`
			select column_name from information_schema.columns
			where table_name like 'full_history_%' and lower(column_name) like '%xdr%'
		`);
		expect(xdrColumns).toEqual([]);
		await expect(
			dataSource.query(
				`update "full_history_transaction_result"
				set "ledger_sequence" = 2 where "batch_id" = $1`,
				[input.batchId]
			)
		).rejects.toThrow(/fk_full_history_result_transaction/i);
	});

	it('deduplicates exact concurrent replay without mutating batch provenance', async () => {
		const input = await seedFullHistoryCheckpoint(dataSource, {
			batchNumber: 2
		});
		const receipts = await Promise.all([
			repository.writeCheckpoint(input),
			repository.writeCheckpoint(input)
		]);
		expect(receipts.map((receipt) => receipt.replayed).sort()).toEqual([
			false,
			true
		]);
		expect(await batchCounts(input.batchId)).toEqual({
			batches: 1,
			ledgers: 63,
			results: 1,
			transactions: 1
		});

		const before = await batchTimestamp(input.batchId);
		await expect(repository.writeCheckpoint(input)).resolves.toMatchObject({
			replayed: true
		});
		expect(await batchTimestamp(input.batchId)).toEqual(before);
		await expect(
			dataSource.query(
				'update "full_history_ingestion_batch" set "decoder_version" = $1 where id = $2',
				['forged', input.batchId]
			)
		).rejects.toThrow(/immutable/);
	});

	it('advances from genesis through a regular 64-ledger checkpoint', async () => {
		const networkPassphrase = 'Canonical contiguous checkpoint network';
		const genesis = await seedFullHistoryCheckpoint(dataSource, {
			batchNumber: 3,
			networkPassphrase
		});
		const regular = await seedFullHistoryCheckpoint(dataSource, {
			batchNumber: 4,
			checkpointLedger: 127,
			networkPassphrase
		});
		await repository.writeCheckpoint(genesis);
		await expect(repository.writeCheckpoint(regular)).resolves.toEqual({
			batchId: regular.batchId,
			nextLedger: '128',
			replayed: false
		});
		expect(await batchCounts(regular.batchId)).toEqual({
			batches: 1,
			ledgers: 64,
			results: 1,
			transactions: 1
		});
		await expect(
			repository.getWatermark(networkPassphrase)
		).resolves.toMatchObject({
			lastBatchId: regular.batchId,
			nextLedger: '128'
		});
	});

	async function batchTimestamp(batchId: string): Promise<string> {
		const rows = (await dataSource.query(
			`select "ingested_at"::text as value
			from "full_history_ingestion_batch" where id = $1`,
			[batchId]
		)) as Array<{ readonly value: string }>;
		if (rows[0] === undefined) throw new Error('Missing batch timestamp');
		return rows[0].value;
	}

	async function batchCounts(batchId: string): Promise<{
		readonly batches: number;
		readonly ledgers: number;
		readonly results: number;
		readonly transactions: number;
	}> {
		const rows = (await dataSource.query(
			`
				select
					(select count(*)::integer from "full_history_ingestion_batch"
						where id = $1) as batches,
					(select count(*)::integer from "full_history_ledger"
						where "batch_id" = $1) as ledgers,
					(select count(*)::integer from "full_history_transaction"
						where "batch_id" = $1) as transactions,
					(select count(*)::integer from "full_history_transaction_result"
						where "batch_id" = $1) as results
			`,
			[batchId]
		)) as Array<{
			readonly batches: number;
			readonly ledgers: number;
			readonly results: number;
			readonly transactions: number;
		}>;
		if (rows[0] === undefined) throw new Error('Missing batch counts');
		return rows[0];
	}
});
