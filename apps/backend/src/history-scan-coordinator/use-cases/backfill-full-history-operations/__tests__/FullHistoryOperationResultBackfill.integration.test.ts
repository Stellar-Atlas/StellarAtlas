import { DataSource } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import type { FullHistoryCheckpointWrite } from '../../../domain/full-history/FullHistoryCanonicalBatch.js';
import { hashNetworkPassphrase } from '../../../domain/full-history/FullHistoryCanonicalTypes.js';
import { TypeOrmFullHistoryOperationBackfillRepository } from '../../../infrastructure/database/full-history-operation-backfill/TypeOrmFullHistoryOperationBackfillRepository.js';
import { insertBatch } from '../../../infrastructure/database/full-history/FullHistoryCanonicalBatchStore.js';
import { storeCanonicalBaseFacts } from '../../../infrastructure/database/full-history/FullHistoryCanonicalFactStore.js';
import { storeCanonicalOperations } from '../../../infrastructure/database/full-history/FullHistoryCanonicalOperationStore.js';
import {
	fullHistoryEntities,
	installFullHistoryCanonicalSchema,
	seedFullHistoryCheckpoint
} from '../../../infrastructure/database/full-history/__tests__/FullHistoryCanonicalFixture.js';
import { StellarFullHistoryCheckpointDecoder } from '../../../infrastructure/full-history-promotion/StellarFullHistoryCheckpointDecoder.js';

jest.setTimeout(60_000);

describe('full-history operation-result backfill compatibility', () => {
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
		await installFullHistoryCanonicalSchema(dataSource);
	});

	afterAll(async () => {
		if (dataSource?.isInitialized) await dataSource.destroy();
		if (postgres !== undefined) await postgres.stop();
	});

	it('backfills results into v2 operation coverage under a v3 checkpoint decoder', async () => {
		const decoder = new StellarFullHistoryCheckpointDecoder();
		const seeded = await seedFullHistoryCheckpoint(dataSource, {
			batchNumber: 2_501,
			networkPassphrase: 'Operation-result decoder compatibility network'
		});
		const input: FullHistoryCheckpointWrite = {
			...seeded,
			decoderVersion: decoder.version,
			operationDecoderVersion: decoder.operationDecoderVersion,
			operationResultDecoderVersion: decoder.operationResultDecoderVersion
		};
		const networkHash = hashNetworkPassphrase(input.networkPassphrase);
		await dataSource.transaction(async (manager) => {
			await insertBatch(manager, input, networkHash);
			await storeCanonicalBaseFacts(manager, input, networkHash);
			await storeCanonicalOperations(manager, input, networkHash);
		});

		const repository = new TypeOrmFullHistoryOperationBackfillRepository(
			dataSource
		);
		await expect(repository.storeOperations(input)).resolves.toEqual({
			batchId: input.batchId,
			operationCount: 1,
			replayed: false
		});
		await expect(coverageVersions(input.batchId)).resolves.toEqual({
			operationDecoderVersion: 'stellar-sdk-16/archive-xdr-v2-operation-facts',
			resultDecoderVersion:
				'stellar-sdk-16/transaction-result-xdr-v1-operation-results'
		});
		await expect(repository.storeOperations(input)).resolves.toMatchObject({
			replayed: true
		});
	});

	async function coverageVersions(batchId: string) {
		const rows = await dataSource.query<
			Array<{
				readonly operationDecoderVersion: string;
				readonly resultDecoderVersion: string;
			}>
		>(
			`select operation."operation_decoder_version"
					as "operationDecoderVersion",
				result."result_decoder_version" as "resultDecoderVersion"
			 from "full_history_operation_batch_coverage" operation
			 join "full_history_operation_result_batch_coverage" result
				on result."batch_id" = operation."batch_id"
			 where operation."batch_id" = $1`,
			[batchId]
		);
		return rows[0];
	}
});
