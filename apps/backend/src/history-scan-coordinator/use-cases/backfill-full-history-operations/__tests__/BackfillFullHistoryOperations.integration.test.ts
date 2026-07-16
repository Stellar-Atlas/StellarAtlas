import { DataSource } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import type { FullHistoryCheckpointWrite } from '../../../domain/full-history/FullHistoryCanonicalBatch.js';
import type { FullHistoryOperationBackfillRepository } from '../../../domain/full-history-operation-backfill/FullHistoryOperationBackfillRepository.js';
import { FULL_HISTORY_OPERATION_BACKFILL_BATCH_LIMIT_MAX } from '../../../domain/full-history-operation-backfill/FullHistoryOperationBackfill.js';
import { deterministicFullHistoryBatchId } from '../../../domain/full-history-promotion/DeterministicFullHistoryBatchId.js';
import { hashNetworkPassphrase } from '../../../domain/full-history/FullHistoryCanonicalTypes.js';
import { CURRENT_HISTORY_ARCHIVE_CHECKPOINT_PROOF_VERSION } from '../../../domain/history-archive-checkpoint-proof/HistoryArchiveCheckpointProof.js';
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
import { FullHistoryOperationBackfillPostgresAssertions } from './FullHistoryOperationBackfillPostgresAssertions.js';

jest.setTimeout(120_000);

interface LegacyBatchFixture {
	readonly input: FullHistoryCheckpointWrite;
	readonly proofId: number;
}

describe('BackfillFullHistoryOperations', () => {
	let candidateRepository: TypeOrmFullHistoryCheckpointCandidateRepository;
	let database: FullHistoryOperationBackfillPostgresAssertions;
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
		database = new FullHistoryOperationBackfillPostgresAssertions(dataSource);
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
		const immutableBefore = await database.immutableRows();

		await dataSource.query(
			`update "history_archive_checkpoint_proof"
			 set "proofVersion" = "proofVersion" + 1
			 where id = $1`,
			[selected.proofId]
		);
		await expect(normalUseCase().execute(runInput(1))).rejects.toMatchObject({
			reason: 'immutable-provenance-mismatch'
		});
		await expect(database.coverageCount()).resolves.toBe(0);
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

		await database.installSlowReferenceCoverageTrigger();
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
			await database.removeSlowReferenceCoverageTrigger();
		}
		await expect(
			database.batchProgress(timeoutFixture.input.batchId)
		).resolves.toEqual({
			accountReferenceCount: 0,
			accountReferenceCoverageCount: 0,
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
		await expect(database.coverageCount()).resolves.toBe(1);

		const restarted = normalUseCase();
		const resumed = await restarted.execute(runInput(1));
		expect(resumed).toMatchObject({
			completedBatches: 1,
			operationFacts: 1,
			status: 'completed'
		});
		expect(resumed.accountReferenceFacts).toBe(
			resumed.receipts[0]!.accountReferenceCount
		);
		await expect(restarted.execute(runInput(1))).resolves.toMatchObject({
			accountReferenceFacts: 0,
			completedBatches: 1,
			operationFacts: 0,
			status: 'completed'
		});
		await expect(restarted.execute(runInput(1))).resolves.toEqual({
			accountReferenceFacts: 0,
			batchLimit: 1,
			completedBatches: 0,
			cpuWorkers: 2,
			databaseWorkers: 2,
			operationFacts: 0,
			peakActiveBatches: 0,
			receipts: [],
			selectedBatches: 0,
			status: 'idle'
		});

		await expect(
			repository.storeOperations(selected.input)
		).resolves.toMatchObject({
			accountReferenceCount: selected.input.operationAccountReferences.length,
			batchId: selected.input.batchId,
			operationCount: 1,
			replayed: true
		});
		expect(await database.operationRows()).toEqual([
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
		await expect(database.operationCoverageRows()).resolves.toEqual([
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
		await expect(
			database.operationAccountReferenceCoverageRows()
		).resolves.toEqual(
			[empty, classic, feeBump].map((fixture) => ({
				accountReferenceCount: fixture.input.operationAccountReferences.length,
				batchId: fixture.input.batchId,
				operationCount: fixture.input.operations.length,
				referenceDecoderVersion: decoder.operationAccountReferenceDecoderVersion
			}))
		);
		await expect(database.operationAccountReferenceCounts()).resolves.toEqual(
			[classic, feeBump].map((fixture) => ({
				batchId: fixture.input.batchId,
				count: fixture.input.operationAccountReferences.length
			}))
		);
		await expect(database.operationResultRows()).resolves.toEqual([
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
		await expect(database.operationResultCoverageRows()).resolves.toEqual([
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
		expect(await database.immutableRows()).toEqual(immutableBefore);
		await expect(
			normalUseCase().execute(
				runInput(FULL_HISTORY_OPERATION_BACKFILL_BATCH_LIMIT_MAX + 1)
			)
		).rejects.toMatchObject({ reason: 'invalid-batch-limit' });
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
		await dataSource.query(
			`update "history_archive_checkpoint_proof"
			 set "proofVersion" = $1
			 where id = $2`,
			[CURRENT_HISTORY_ARCHIVE_CHECKPOINT_PROOF_VERSION, seeded.proofId]
		);
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
			operationAccountReferenceDecoderVersion:
				decoder.operationAccountReferenceDecoderVersion,
			operationAccountReferences: decoded.operationAccountReferences,
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
			databaseWorkerCount: 2,
			networkPassphrase: publicNetworkPassphrase
		};
	}
});
