import type { DataSource } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import { hashNetworkPassphrase } from '../../../../domain/full-history/FullHistoryCanonicalTypes.js';
import { TypeOrmFullHistoryOperationBackfillRepository } from '../../../database/full-history-operation-backfill/TypeOrmFullHistoryOperationBackfillRepository.js';
import { insertBatch } from '../../../database/full-history/FullHistoryCanonicalBatchStore.js';
import { storeCanonicalBaseFacts } from '../../../database/full-history/FullHistoryCanonicalFactStore.js';
import {
	installFullHistoryCanonicalSchema,
	seedFullHistoryCheckpoint
} from '../../../database/full-history/__tests__/FullHistoryCanonicalFixture.js';
import { FullHistoryIngestionBatch } from '../../../database/full-history/entities/FullHistoryIngestionBatch.js';
import { createFullHistoryOperationBackfillDataSource } from '../FullHistoryOperationBackfillComposition.js';

jest.setTimeout(60_000);

describe('full-history operation backfill DataSource composition', () => {
	let dataSource: DataSource;
	let postgres: DisposablePostgres;

	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		dataSource = createFullHistoryOperationBackfillDataSource().setOptions({
			extra: undefined,
			ssl: false,
			url: postgres.url
		});
		await dataSource.initialize();
		await installFullHistoryCanonicalSchema(dataSource);
	});

	afterAll(async () => {
		if (dataSource?.isInitialized) await dataSource.destroy();
		if (postgres !== undefined) await postgres.stop();
	});

	it('loads canonical metadata and persists a decoded legacy batch', async () => {
		expect(
			dataSource.entityMetadatas.map((metadata) => metadata.tableName).sort()
		).toEqual([
			'full_history_ingestion_batch',
			'full_history_ledger',
			'full_history_operation',
			'full_history_operation_result',
			'full_history_transaction',
			'full_history_transaction_result',
			'full_history_watermark'
		]);
		expect(dataSource.getMetadata(FullHistoryIngestionBatch).tableName).toBe(
			'full_history_ingestion_batch'
		);
		const input = await seedFullHistoryCheckpoint(dataSource, {
			batchNumber: 701
		});
		const networkHash = hashNetworkPassphrase(input.networkPassphrase);
		await dataSource.transaction(async (manager) => {
			await insertBatch(manager, input, networkHash);
			await storeCanonicalBaseFacts(manager, input, networkHash);
		});

		await expect(
			new TypeOrmFullHistoryOperationBackfillRepository(
				dataSource
			).storeOperations(input)
		).resolves.toEqual({
			accountReferenceCount: input.operationAccountReferences.length,
			batchId: input.batchId,
			operationCount: input.operations.length,
			replayed: false
		});
		const coverage = await dataSource.query<
			readonly { readonly batchId: string }[]
		>(
			`select "batch_id" as "batchId"
			 from "full_history_operation_account_reference_batch_coverage"`
		);
		expect(coverage).toEqual([{ batchId: input.batchId }]);
	});
});
