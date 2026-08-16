import { DataSource, type Logger } from 'typeorm';
import { StrKey } from '@stellar/stellar-sdk';
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
import { storeCanonicalOperationResults } from '../../../infrastructure/database/full-history/FullHistoryCanonicalOperationResultStore.js';
import {
	fullHistoryEntities,
	installFullHistoryCanonicalSchema,
	seedFullHistoryCheckpoint
} from '../../../infrastructure/database/full-history/__tests__/FullHistoryCanonicalFixture.js';
import { StellarFullHistoryCheckpointDecoder } from '../../../infrastructure/full-history-promotion/StellarFullHistoryCheckpointDecoder.js';

class QueryRecorder implements Logger {
	private queries: string[] = [];

	logQuery(query: string): void {
		this.queries.push(query);
	}

	logQueryError(): void {
		return;
	}

	logQuerySlow(): void {
		return;
	}

	logSchemaBuild(): void {
		return;
	}

	logMigration(): void {
		return;
	}

	log(): void {
		return;
	}

	normalizedQueries(): readonly string[] {
		return this.queries.map((query) => query.replaceAll(/\s+/g, ' ').trim());
	}

	reset(): void {
		this.queries = [];
	}
}

jest.setTimeout(60_000);

describe('full-history operation-result backfill compatibility', () => {
	let dataSource: DataSource;
	let postgres: DisposablePostgres;
	const queryRecorder = new QueryRecorder();

	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		dataSource = new DataSource({
			entities: fullHistoryEntities,
			logger: queryRecorder,
			logging: ['query'],
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
			accountReferenceCount: input.operationAccountReferences.length,
			batchId: input.batchId,
			operationCount: 1,
			replayed: false
		});
		await expect(coverageVersions(input.batchId)).resolves.toEqual({
			operationDecoderVersion: 'stellar-sdk-16/archive-xdr-v2-operation-facts',
			referenceDecoderVersion: 'fixture-operation-account-reference-decoder/1',
			resultDecoderVersion:
				'stellar-sdk-16/transaction-result-xdr-v1-operation-results'
		});
		await expect(repository.storeOperations(input)).resolves.toMatchObject({
			replayed: true
		});
	});

	it('writes only a missing component during partial-coverage catch-up', async () => {
		const input = await seedFullHistoryCheckpoint(dataSource, {
			batchNumber: 2_502,
			networkPassphrase: 'Component-aware operation backfill network'
		});
		const networkHash = hashNetworkPassphrase(input.networkPassphrase);
		await dataSource.transaction(async (manager) => {
			await insertBatch(manager, input, networkHash);
			await storeCanonicalBaseFacts(manager, input, networkHash);
			await storeCanonicalOperations(manager, input, networkHash);
			await storeCanonicalOperationResults(manager, input, networkHash);
		});
		queryRecorder.reset();

		const repository = new TypeOrmFullHistoryOperationBackfillRepository(
			dataSource
		);
		await expect(repository.storeOperations(input)).resolves.toEqual({
			accountReferenceCount: input.operationAccountReferences.length,
			batchId: input.batchId,
			operationCount: input.operations.length,
			replayed: false
		});

		const queries = queryRecorder.normalizedQueries();
		expect(queries).toEqual(
			expect.arrayContaining([
				expect.stringContaining(
					'insert into "full_history_operation_account_reference"'
				),
				expect.stringContaining(
					'insert into "full_history_operation_account_reference_batch_coverage"'
				)
			])
		);
		expect(
			queries.some((query) =>
				query.includes('from "full_history_operation" where "batch_id"')
			)
		).toBe(false);
		expect(
			queries.some((query) =>
				query.includes('from "full_history_operation_result" result')
			)
		).toBe(false);
		expect(
			queries.some((query) =>
				query.includes('insert into "full_history_operation" (')
			)
		).toBe(false);
		expect(
			queries.some((query) =>
				query.includes('insert into "full_history_operation_result" (')
			)
		).toBe(false);
		await expect(coverageVersions(input.batchId)).resolves.toEqual({
			operationDecoderVersion: input.operationDecoderVersion,
			referenceDecoderVersion: input.operationAccountReferenceDecoderVersion,
			resultDecoderVersion: input.operationResultDecoderVersion
		});
	});

	it('advances and clears durable progress across multiple reference chunks', async () => {
		const input = await seedFullHistoryCheckpoint(dataSource, {
			batchNumber: 2_503,
			explicitOperationAccountReferences: Array.from(
				{ length: 500 },
				(_, index) => ({
					accountId: fixtureAccountId(index + 1),
					role: 'destination' as const
				})
			),
			networkPassphrase: 'Multi-chunk operation-reference network'
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
		).resolves.toMatchObject({
			accountReferenceCount: 501,
			batchId: input.batchId,
			replayed: false
		});

		const rows = await dataSource.query<
			Array<{
				readonly coverageCount: number;
				readonly progressCount: number;
				readonly referenceCount: number;
			}>
		>(
			`select
				(select count(*)::integer
				 from "full_history_operation_account_reference" reference
				 join "full_history_operation" operation
					on operation."network_passphrase_hash" =
						reference."network_passphrase_hash"
					and operation."transaction_hash" =
						reference."transaction_hash"
					and operation."operation_index" = reference."operation_index"
				 where operation."batch_id" = $1) as "referenceCount",
				(select count(*)::integer
				 from "full_history_operation_account_reference_batch_coverage"
				 where "batch_id" = $1) as "coverageCount",
				(select count(*)::integer
				 from "full_history_operation_projection_progress"
				 where "batch_id" = $1) as "progressCount"`,
			[input.batchId]
		);
		expect(rows).toEqual([
			{ coverageCount: 1, progressCount: 0, referenceCount: 501 }
		]);
	});

	async function coverageVersions(batchId: string) {
		const rows = await dataSource.query<
			Array<{
				readonly operationDecoderVersion: string;
				readonly referenceDecoderVersion: string;
				readonly resultDecoderVersion: string;
			}>
		>(
			`select operation."operation_decoder_version"
					as "operationDecoderVersion",
				reference."reference_decoder_version"
					as "referenceDecoderVersion",
				result."result_decoder_version" as "resultDecoderVersion"
			 from "full_history_operation_batch_coverage" operation
			 join "full_history_operation_account_reference_batch_coverage"
				reference on reference."batch_id" = operation."batch_id"
			 join "full_history_operation_result_batch_coverage" result
				on result."batch_id" = operation."batch_id"
			 where operation."batch_id" = $1`,
			[batchId]
		);
		return rows[0];
	}
});

function fixtureAccountId(index: number): string {
	const raw = Buffer.alloc(32);
	raw.writeUInt32BE(index, 28);
	return StrKey.encodeEd25519PublicKey(raw);
}
