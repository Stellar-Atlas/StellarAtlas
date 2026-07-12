import { DataSource } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import { hashNetworkPassphrase } from '../../../../domain/full-history/FullHistoryCanonicalTypes.js';
import { insertBatch } from '../../full-history/FullHistoryCanonicalBatchStore.js';
import { storeCanonicalBaseFacts } from '../../full-history/FullHistoryCanonicalFactStore.js';
import {
	fullHistoryEntities,
	installFullHistoryPrerequisites,
	seedFullHistoryCheckpoint
} from '../../full-history/__tests__/FullHistoryCanonicalFixture.js';
import { FullHistoryCanonicalSchemaMigration1784860000000 } from '../1784860000000-FullHistoryCanonicalSchemaMigration.js';
import { FullHistoryOperationFactsMigration1784960000000 } from '../1784960000000-FullHistoryOperationFactsMigration.js';
import { FullHistoryOperationBackfillMigration1784970000000 } from '../1784970000000-FullHistoryOperationBackfillMigration.js';

jest.setTimeout(60_000);

describe('FullHistoryOperationBackfillMigration1784970000000', () => {
	let dataSource: DataSource;
	let postgres: DisposablePostgres;

	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		dataSource = new DataSource({
			entities: fullHistoryEntities,
			type: 'postgres',
			url: postgres.url
		});
		await dataSource.initialize();
		const runner = dataSource.createQueryRunner();
		await runner.connect();
		await runner.startTransaction();
		await installFullHistoryPrerequisites(runner);
		await new FullHistoryCanonicalSchemaMigration1784860000000().up(runner);
		await new FullHistoryOperationFactsMigration1784960000000().up(runner);
		await runner.commitTransaction();
		await runner.release();
	});

	afterAll(async () => {
		if (dataSource?.isInitialized) await dataSource.destroy();
		if (postgres !== undefined) await postgres.stop();
	});

	it('adds immutable operation-decoder provenance to existing coverage', async () => {
		const input = await seedFullHistoryCheckpoint(dataSource, {
			batchNumber: 1_497,
			decoderVersion: 'stellar-sdk-16/archive-xdr-v2-operation-facts'
		});
		const networkHash = hashNetworkPassphrase(input.networkPassphrase);
		await dataSource.transaction(async (manager) => {
			await insertBatch(manager, input, networkHash);
			await storeCanonicalBaseFacts(manager, input, networkHash);
			const operation = input.operations[0]!;
			await manager.query(
				`insert into "full_history_operation" (
					"network_passphrase_hash", "transaction_hash", "operation_index",
					"batch_id", "ledger_sequence", "transaction_index",
					"operation_type", "source_account", "source_account_origin",
					"fact_scope"
				) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
				[
					networkHash.toBuffer(),
					operation.transactionHash.toBuffer(),
					operation.operationIndex,
					input.batchId,
					operation.ledgerSequence,
					operation.transactionIndex,
					operation.operationType,
					operation.sourceAccount,
					operation.sourceAccountOrigin,
					operation.factScope
				]
			);
			await manager.query(
				`insert into "full_history_operation_batch_coverage" (
					"batch_id", "network_passphrase_hash", "first_ledger",
					"last_ledger", "transaction_count", "operation_count",
					"fact_scope"
				) values ($1, $2, $3, $4, $5, $6, $7)`,
				[
					input.batchId,
					networkHash.toBuffer(),
					input.firstLedger,
					input.lastLedger,
					input.transactions.length,
					input.operations.length,
					'operation_body_and_envelope'
				]
			);
		});

		const migration = new FullHistoryOperationBackfillMigration1784970000000();
		const runner = dataSource.createQueryRunner();
		await runner.connect();
		await expect(migration.up(runner)).rejects.toThrow(/active transaction/i);
		await runner.startTransaction();
		await migration.up(runner);
		await runner.commitTransaction();
		await runner.release();

		const rows = await dataSource.query<
			Array<{ readonly operationDecoderVersion: string }>
		>(
			`select "operation_decoder_version" as "operationDecoderVersion"
			 from "full_history_operation_batch_coverage"
			 where "batch_id" = $1`,
			[input.batchId]
		);
		expect(rows).toEqual([
			{
				operationDecoderVersion: 'stellar-sdk-16/archive-xdr-v2-operation-facts'
			}
		]);
		await expect(
			dataSource.query(
				`update "full_history_operation_batch_coverage"
				 set "operation_decoder_version" = 'forged' where "batch_id" = $1`,
				[input.batchId]
			)
		).rejects.toThrow(/immutable/i);
	});
});
