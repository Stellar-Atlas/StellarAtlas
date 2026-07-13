import { DataSource } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import type { FullHistoryCheckpointWrite } from '../../../domain/full-history/FullHistoryCanonicalBatch.js';
import type { FullHistoryOperationBackfillRepository } from '../../../domain/full-history-operation-backfill/FullHistoryOperationBackfillRepository.js';
import { deterministicFullHistoryBatchId } from '../../../domain/full-history-promotion/DeterministicFullHistoryBatchId.js';
import { hashNetworkPassphrase } from '../../../domain/full-history/FullHistoryCanonicalTypes.js';
import {
	acquireFullHistoryOperationBackfillLeadership,
	type FullHistoryOperationBackfillLeadershipLease
} from '../../../infrastructure/cli/full-history-operation-backfill/FullHistoryOperationBackfillLeadership.js';
import { TypeOrmFullHistoryOperationBackfillRepository } from '../../../infrastructure/database/full-history-operation-backfill/TypeOrmFullHistoryOperationBackfillRepository.js';
import { insertBatch } from '../../../infrastructure/database/full-history/FullHistoryCanonicalBatchStore.js';
import { storeCanonicalBaseFacts } from '../../../infrastructure/database/full-history/FullHistoryCanonicalFactStore.js';
import { storeCanonicalOperations } from '../../../infrastructure/database/full-history/FullHistoryCanonicalOperationStore.js';
import { fullHistoryEntities } from '../../../infrastructure/database/full-history/__tests__/FullHistoryCanonicalFixture.js';
import { TypeOrmFullHistoryCheckpointCandidateRepository } from '../../../infrastructure/database/full-history-promotion/TypeOrmFullHistoryCheckpointCandidateRepository.js';
import {
	installPromotionSchema,
	seedPromotionCandidate
} from '../../../infrastructure/database/full-history-promotion/__tests__/FullHistoryPromotionPostgresFixture.js';
import { StellarFullHistoryCheckpointDecoder } from '../../../infrastructure/full-history-promotion/StellarFullHistoryCheckpointDecoder.js';
import {
	publicNetworkPassphrase,
	readClassicArchiveTransactionFixture,
	readFeeBumpEtlFixture
} from '../../../infrastructure/full-history-promotion/__tests__/RealStellarXdrFixtures.js';
import { BackfillFullHistoryOperations } from '../BackfillFullHistoryOperations.js';

jest.setTimeout(120_000);

interface LegacyBatchFixture {
	readonly input: FullHistoryCheckpointWrite;
	readonly proofId: number;
}

interface ImmutableRowSnapshot {
	readonly identity: string;
	readonly xmin: string;
}

describe('BackfillFullHistoryOperations', () => {
	let candidateRepository: TypeOrmFullHistoryCheckpointCandidateRepository;
	let dataSource: DataSource;
	let decoder: StellarFullHistoryCheckpointDecoder;
	let postgres: DisposablePostgres;
	let repository: TypeOrmFullHistoryOperationBackfillRepository;

	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		dataSource = new DataSource({
			entities: fullHistoryEntities,
			type: 'postgres',
			url: postgres.url
		});
		await dataSource.initialize();
		await installPromotionSchema(dataSource);
		candidateRepository = new TypeOrmFullHistoryCheckpointCandidateRepository(
			dataSource
		);
		decoder = new StellarFullHistoryCheckpointDecoder();
		repository = new TypeOrmFullHistoryOperationBackfillRepository(dataSource);
	});

	afterAll(async () => {
		if (dataSource?.isInitialized) await dataSource.destroy();
		if (postgres !== undefined) await postgres.stop();
	});

	it('admits one database-wide leader and hands off after release', async () => {
		const leases: FullHistoryOperationBackfillLeadershipLease[] = [];
		try {
			const leader =
				await acquireFullHistoryOperationBackfillLeadership(dataSource);
			leases.push(leader);
			const contender =
				await acquireFullHistoryOperationBackfillLeadership(dataSource);
			leases.push(contender);
			expect(leader.acquired).toBe(true);
			expect(contender.acquired).toBe(false);

			await leader.release();
			const successor =
				await acquireFullHistoryOperationBackfillLeadership(dataSource);
			leases.push(successor);
			expect(successor.acquired).toBe(true);
		} finally {
			for (const lease of leases) await lease.release();
		}
	});

	it('rolls back timed-out progress, resumes after a crash, and covers every batch once', async () => {
		const classic = await seedLegacyBatch(201, {
			transaction: readClassicArchiveTransactionFixture()
		});
		const feeBump = await seedLegacyBatch(202, {
			transaction: readFeeBumpEtlFixture()
		});
		const empty = await seedLegacyBatch(203, { checkpointLedger: 63 });
		const fixtures = [classic, feeBump, empty];
		const selectedBatch = (
			await repository.findUnindexedBatches(publicNetworkPassphrase, 1)
		)[0];
		const selected = fixtures.find(
			(fixture) => fixture.input.batchId === selectedBatch?.batchId
		);
		if (selected === undefined) throw new Error('Expected one selected batch');
		const timeoutFixture = [classic, feeBump].find(
			(fixture) => fixture.input.batchId !== selected.input.batchId
		);
		if (timeoutFixture === undefined) {
			throw new Error('Expected a separate timeout batch');
		}
		const immutableBefore = await immutableRows();

		await dataSource.query(
			`update "history_archive_checkpoint_proof"
			 set "proofVersion" = "proofVersion" + 1
			 where id = $1`,
			[selected.proofId]
		);
		await expect(normalUseCase().execute(runInput(1))).rejects.toMatchObject({
			reason: 'immutable-provenance-mismatch'
		});
		await expect(coverageCount()).resolves.toBe(0);
		await dataSource.query(
			`update "history_archive_checkpoint_proof"
			 set "proofVersion" = $1 where id = $2`,
			[selected.input.proofVersion, selected.proofId]
		);
		await dataSource.transaction((manager) =>
			storeCanonicalOperations(
				manager,
				selected.input,
				hashNetworkPassphrase(publicNetworkPassphrase),
				decoder.operationDecoderVersion
			)
		);

		await installSlowCoverageTrigger();
		try {
			const timeoutRepository =
				new TypeOrmFullHistoryOperationBackfillRepository(dataSource, {
					lockTimeoutMs: 2_000,
					statementTimeoutMs: 250
				});
			let timeoutError: unknown;
			try {
				await timeoutRepository.storeOperations(timeoutFixture.input);
			} catch (error) {
				timeoutError = error;
			}
			expect(timeoutError).toMatchObject({
				code: '57014',
				where: expect.stringContaining('pg_sleep')
			});
		} finally {
			await removeSlowCoverageTrigger();
		}
		await expect(batchProgress(timeoutFixture.input.batchId)).resolves.toEqual({
			coverageCount: 0,
			operationCount: 0
		});

		const crashingRepository: FullHistoryOperationBackfillRepository = {
			findUnindexedBatches: (networkPassphrase, limit) =>
				repository.findUnindexedBatches(networkPassphrase, limit),
			storeOperations: async (input) => {
				await repository.storeOperations(input);
				throw new Error('simulated process crash after commit');
			}
		};
		await expect(
			new BackfillFullHistoryOperations(
				crashingRepository,
				candidateRepository,
				decoder
			).execute(runInput(1))
		).rejects.toThrow('simulated process crash after commit');
		await expect(coverageCount()).resolves.toBe(1);

		const restarted = normalUseCase();
		await expect(restarted.execute(runInput(1))).resolves.toMatchObject({
			completedBatches: 1,
			operationFacts: 1,
			status: 'completed'
		});
		await expect(restarted.execute(runInput(1))).resolves.toMatchObject({
			completedBatches: 1,
			operationFacts: 0,
			status: 'completed'
		});
		await expect(restarted.execute(runInput(1))).resolves.toEqual({
			batchLimit: 1,
			completedBatches: 0,
			cpuWorkers: 2,
			operationFacts: 0,
			peakActiveBatches: 0,
			receipts: [],
			selectedBatches: 0,
			status: 'idle'
		});

		await expect(
			repository.storeOperations(selected.input)
		).resolves.toMatchObject({
			batchId: selected.input.batchId,
			operationCount: 1,
			replayed: true
		});
		expect(await operationRows()).toEqual([
			{
				batchId: classic.input.batchId,
				operationType: 'create_account',
				sourceAccount:
					'GD6WU64OEP5C4LRBH6NK3MHYIA2ADN6K6II6EXPNVUR3ERBXT4AN4ACD',
				sourceAccountOrigin: 'operation',
				transactionHash:
					'06261feeb7a3f0e56883b4f585e61f787ce3436949fe6305e7ed676de69140a2'
			},
			{
				batchId: feeBump.input.batchId,
				operationType: 'invoke_host_function',
				sourceAccount:
					'GA2DUR2ZXDJM6CYREPP45E6UPZZP2765YUC65FCBJRV3AIY7ZPFXEGL3',
				sourceAccountOrigin: 'transaction',
				transactionHash:
					'c08806d61690a168bbd0159bd6ece44a34b57ca15b36ff52f2d5668adcd85901'
			}
		]);
		await expect(coverageRows()).resolves.toEqual([
			{
				batchId: empty.input.batchId,
				operationCount: 0,
				operationDecoderVersion: decoder.operationDecoderVersion,
				transactionCount: 0
			},
			{
				batchId: classic.input.batchId,
				operationCount: 1,
				operationDecoderVersion: decoder.operationDecoderVersion,
				transactionCount: 1
			},
			{
				batchId: feeBump.input.batchId,
				operationCount: 1,
				operationDecoderVersion: decoder.operationDecoderVersion,
				transactionCount: 1
			}
		]);
		await expect(operationResultRows()).resolves.toEqual([
			{
				batchId: classic.input.batchId,
				factScope: 'transaction_result_xdr',
				operationResultCode: 0,
				operationSpecificResultCode: 0,
				outcome: 'succeeded'
			},
			{
				batchId: feeBump.input.batchId,
				factScope: 'transaction_result_xdr',
				operationResultCode: 0,
				operationSpecificResultCode: 0,
				outcome: 'succeeded'
			}
		]);
		await expect(operationResultCoverageRows()).resolves.toEqual([
			{
				batchId: empty.input.batchId,
				operationCount: 0,
				resultDecoderVersion: decoder.operationResultDecoderVersion
			},
			{
				batchId: classic.input.batchId,
				operationCount: 1,
				resultDecoderVersion: decoder.operationResultDecoderVersion
			},
			{
				batchId: feeBump.input.batchId,
				operationCount: 1,
				resultDecoderVersion: decoder.operationResultDecoderVersion
			}
		]);
		expect(await immutableRows()).toEqual(immutableBefore);
		await expect(normalUseCase().execute(runInput(9))).rejects.toMatchObject({
			reason: 'invalid-batch-limit'
		});
	});

	function normalUseCase(): BackfillFullHistoryOperations {
		return new BackfillFullHistoryOperations(
			repository,
			candidateRepository,
			decoder
		);
	}

	async function seedLegacyBatch(
		seed: number,
		options: {
			readonly checkpointLedger?: number;
			readonly transaction?: ReturnType<
				typeof readClassicArchiveTransactionFixture
			>;
		}
	): Promise<LegacyBatchFixture> {
		const seeded = await seedPromotionCandidate(dataSource, {
			...(options.checkpointLedger === undefined
				? {}
				: { checkpointLedger: options.checkpointLedger }),
			networkPassphrase: publicNetworkPassphrase,
			seed,
			...(options.transaction === undefined
				? {}
				: { transaction: options.transaction })
		});
		const candidate = await candidateRepository.load(seeded.target);
		const decoded = await decoder.decode(candidate, publicNetworkPassphrase);
		const input: FullHistoryCheckpointWrite = {
			archiveUrlIdentity: candidate.proof.archiveUrlIdentity,
			batchId: deterministicFullHistoryBatchId(
				candidate,
				'stellar-sdk-16/archive-xdr-v1'
			),
			checkpointLedger: candidate.proof.checkpointLedger,
			decoderVersion: 'stellar-sdk-16/archive-xdr-v1',
			firstLedger: decoded.ledgers[0]!.ledgerSequence,
			lastLedger: decoded.ledgers.at(-1)!.ledgerSequence,
			ledgers: decoded.ledgers,
			networkPassphrase: publicNetworkPassphrase,
			operationDecoderVersion: decoder.operationDecoderVersion,
			operations: decoded.operations,
			operationResultDecoderVersion: decoder.operationResultDecoderVersion,
			operationResults: decoded.operationResults,
			proofEvaluatedAt: candidate.proof.evaluatedAt,
			proofId: candidate.proof.id,
			proofVersion: candidate.proof.version,
			results: decoded.results,
			sources: candidate.proof.sources,
			transactions: decoded.transactions
		};
		const networkHash = hashNetworkPassphrase(publicNetworkPassphrase);
		await dataSource.transaction(async (manager) => {
			await insertBatch(manager, input, networkHash);
			await storeCanonicalBaseFacts(manager, input, networkHash);
		});
		return { input, proofId: seeded.proofId };
	}

	function runInput(batchLimit: number) {
		return {
			batchLimit,
			cpuWorkerCount: 2,
			networkPassphrase: publicNetworkPassphrase
		};
	}

	async function coverageCount(): Promise<number> {
		const rows = await dataSource.query<Array<{ readonly count: number }>>(
			`select count(*)::integer as count
			 from "full_history_operation_batch_coverage"`
		);
		return rows[0]?.count ?? -1;
	}

	async function batchProgress(batchId: string): Promise<{
		readonly coverageCount: number;
		readonly operationCount: number;
	}> {
		const rows = await dataSource.query<
			Array<{
				readonly coverageCount: number;
				readonly operationCount: number;
			}>
		>(
			`select
				(select count(*)::integer
				 from "full_history_operation_batch_coverage"
				 where "batch_id" = $1) as "coverageCount",
				(select count(*)::integer from "full_history_operation"
				 where "batch_id" = $1) as "operationCount"`,
			[batchId]
		);
		return rows[0] ?? { coverageCount: -1, operationCount: -1 };
	}

	async function installSlowCoverageTrigger(): Promise<void> {
		await dataSource.query(`
			create function full_history_operation_backfill_test_timeout()
			returns trigger language plpgsql as $function$
			begin
				perform pg_sleep(1);
				return new;
			end
			$function$
		`);
		await dataSource.query(`
			create trigger full_history_operation_backfill_test_timeout
			before insert on "full_history_operation_batch_coverage"
			for each row execute function
				full_history_operation_backfill_test_timeout()
		`);
	}

	async function removeSlowCoverageTrigger(): Promise<void> {
		await dataSource.query(`
			drop trigger if exists full_history_operation_backfill_test_timeout
			on "full_history_operation_batch_coverage"
		`);
		await dataSource.query(`
			drop function if exists full_history_operation_backfill_test_timeout()
		`);
	}

	async function immutableRows(): Promise<ImmutableRowSnapshot[]> {
		return dataSource.query<ImmutableRowSnapshot[]>(`
			select 'batch:' || id::text as identity, xmin::text as xmin
			from "full_history_ingestion_batch"
			union all
			select 'transaction:' || encode("transaction_hash", 'hex'),
				xmin::text as xmin
			from "full_history_transaction"
			order by identity
		`);
	}

	async function operationRows() {
		return dataSource.query<
			Array<{
				readonly batchId: string;
				readonly operationType: string;
				readonly sourceAccount: string;
				readonly sourceAccountOrigin: string;
				readonly transactionHash: string;
			}>
		>(`
			select "batch_id" as "batchId", "operation_type" as "operationType",
				"source_account" as "sourceAccount",
				"source_account_origin" as "sourceAccountOrigin",
				encode("transaction_hash", 'hex') as "transactionHash"
			from "full_history_operation"
			order by "operation_type"
		`);
	}

	async function coverageRows() {
		return dataSource.query<
			Array<{
				readonly batchId: string;
				readonly operationCount: number;
				readonly operationDecoderVersion: string;
				readonly transactionCount: number;
			}>
		>(`
			select coverage."batch_id" as "batchId",
				coverage."operation_count" as "operationCount",
				coverage."operation_decoder_version" as "operationDecoderVersion",
				coverage."transaction_count" as "transactionCount"
			from "full_history_operation_batch_coverage" coverage
			join "full_history_ingestion_batch" batch
				on batch.id = coverage."batch_id"
			order by batch."last_ledger"
		`);
	}

	async function operationResultRows() {
		return dataSource.query<
			Array<{
				readonly batchId: string;
				readonly factScope: string;
				readonly operationResultCode: number | null;
				readonly operationSpecificResultCode: number | null;
				readonly outcome: string;
			}>
		>(`
			select operation."batch_id" as "batchId", result."outcome",
				result."operation_result_code" as "operationResultCode",
				result."operation_specific_result_code"
					as "operationSpecificResultCode",
				result."fact_scope" as "factScope"
			from "full_history_operation_result" result
			join "full_history_operation" operation
				on operation."network_passphrase_hash" =
					result."network_passphrase_hash"
				and operation."transaction_hash" = result."transaction_hash"
				and operation."operation_index" = result."operation_index"
			join "full_history_ingestion_batch" batch
				on batch.id = operation."batch_id"
			order by batch."last_ledger"
		`);
	}

	async function operationResultCoverageRows() {
		return dataSource.query<
			Array<{
				readonly batchId: string;
				readonly operationCount: number;
				readonly resultDecoderVersion: string;
			}>
		>(`
			select coverage."batch_id" as "batchId",
				coverage."operation_count" as "operationCount",
				coverage."result_decoder_version" as "resultDecoderVersion"
			from "full_history_operation_result_batch_coverage" coverage
			join "full_history_ingestion_batch" batch
				on batch.id = coverage."batch_id"
			order by batch."last_ledger"
		`);
	}
});
