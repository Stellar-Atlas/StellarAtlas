import { DataSource } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import type { FullHistoryPromotionTarget } from '../../../domain/full-history-promotion/FullHistoryCheckpointCandidate.js';
import { TypeOrmFullHistoryCanonicalRepository } from '../../../infrastructure/database/full-history/TypeOrmFullHistoryCanonicalRepository.js';
import { fullHistoryEntities } from '../../../infrastructure/database/full-history/__tests__/FullHistoryCanonicalFixture.js';
import { TypeOrmFullHistoryHistoricalBackfillRepository } from '../../../infrastructure/database/full-history-backfill/TypeOrmFullHistoryHistoricalBackfillRepository.js';
import { TypeOrmFullHistoryCheckpointCandidateRepository } from '../../../infrastructure/database/full-history-promotion/TypeOrmFullHistoryCheckpointCandidateRepository.js';
import {
	installPromotionSchema,
	seedPromotionCandidate,
	type SeededPromotionCandidate
} from '../../../infrastructure/database/full-history-promotion/__tests__/FullHistoryPromotionPostgresFixture.js';
import { FullHistoryHistoricalBackfillMigration1784940000000 } from '../../../infrastructure/database/migrations/1784940000000-FullHistoryHistoricalBackfillMigration.js';
import { StellarFullHistoryCheckpointDecoder } from '../../../infrastructure/full-history-promotion/StellarFullHistoryCheckpointDecoder.js';
import { PromoteFullHistoryCheckpoint } from '../../promote-full-history-checkpoint/PromoteFullHistoryCheckpoint.js';
import { PrependFullHistoryCheckpoint } from '../../prepend-full-history-checkpoint/PrependFullHistoryCheckpoint.js';
import { ScheduleFullHistoryBackfill } from '../../schedule-full-history-backfill/ScheduleFullHistoryBackfill.js';
import {
	RunFullHistoryBackfill,
	type FullHistoryHistoricalCheckpointPromoter
} from '../RunFullHistoryBackfill.js';

jest.setTimeout(90_000);

const workerOne = '00000000-0000-4000-8000-000000001101';
const workerTwo = '00000000-0000-4000-8000-000000001102';

describe('RunFullHistoryBackfill with strict PostgreSQL evidence', () => {
	let backfillRepository: TypeOrmFullHistoryHistoricalBackfillRepository;
	let canonicalRepository: TypeOrmFullHistoryCanonicalRepository;
	let dataSource: DataSource;
	let forwardPromoter: PromoteFullHistoryCheckpoint;
	let postgres: DisposablePostgres;
	let prepender: PrependFullHistoryCheckpoint;

	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		dataSource = new DataSource({
			entities: fullHistoryEntities,
			type: 'postgres',
			url: postgres.url
		});
		await dataSource.initialize();
		await installPromotionSchema(dataSource);
		const runner = dataSource.createQueryRunner();
		await runner.connect();
		await runner.startTransaction();
		await new FullHistoryHistoricalBackfillMigration1784940000000().up(runner);
		await runner.commitTransaction();
		await runner.release();

		canonicalRepository = new TypeOrmFullHistoryCanonicalRepository(dataSource);
		const candidates = new TypeOrmFullHistoryCheckpointCandidateRepository(
			dataSource
		);
		const decoder = new StellarFullHistoryCheckpointDecoder();
		forwardPromoter = new PromoteFullHistoryCheckpoint(
			candidates,
			decoder,
			canonicalRepository
		);
		prepender = new PrependFullHistoryCheckpoint(
			candidates,
			decoder,
			canonicalRepository
		);
		backfillRepository = new TypeOrmFullHistoryHistoricalBackfillRepository(
			dataSource
		);
	});

	afterAll(async () => {
		if (dataSource?.isInitialized) await dataSource.destroy();
		if (postgres !== undefined) await postgres.stop();
	});

	it('schedules and completes one immediately adjacent checkpoint', async () => {
		const range = await seedLinkedRange(
			'Historical one checkpoint network',
			[127, 191],
			1_110
		);
		await forwardPromoter.promote(range.at(-1)!.target);
		const scheduler = schedulerWithId(1_111);
		const scheduled = await scheduler.execute({
			checkpointCount: 1,
			maxAttempts: 4,
			networkPassphrase: range[0]!.target.networkPassphrase
		});
		expect(scheduled.status).toBe('scheduled');
		await expect(
			scheduler.execute({
				checkpointCount: 1,
				maxAttempts: 4,
				networkPassphrase: range[0]!.target.networkPassphrase
			})
		).resolves.toMatchObject({ status: 'existing' });

		const result = await worker(prepender).execute(
			workerInput(range[0]!.target.networkPassphrase, workerOne)
		);
		expect(result).toMatchObject({
			processedCheckpoints: 1,
			status: 'completed'
		});
		await expect(
			backfillRepository.findFrontier(range[0]!.target.networkPassphrase)
		).resolves.toMatchObject({ firstLedger: '64', nextLedger: '192' });
	});

	it('processes a multi-checkpoint range newest to oldest', async () => {
		const range = await seedLinkedRange(
			'Historical descending network',
			[191, 255, 319],
			1_120
		);
		await forwardPromoter.promote(range.at(-1)!.target);
		await schedulerWithId(1_121).execute({
			checkpointCount: 2,
			maxAttempts: 4,
			networkPassphrase: range[0]!.target.networkPassphrase
		});
		const order: number[] = [];
		const recordingPromoter: FullHistoryHistoricalCheckpointPromoter = {
			promote: async (target) => {
				order.push(target.checkpointLedger);
				return prepender.promote(target);
			}
		};

		await expect(
			worker(recordingPromoter).execute(
				workerInput(range[0]!.target.networkPassphrase, workerOne)
			)
		).resolves.toMatchObject({
			processedCheckpoints: 2,
			status: 'completed'
		});
		expect(order).toEqual([255, 191]);
		await expect(
			backfillRepository.findFrontier(range[0]!.target.networkPassphrase)
		).resolves.toMatchObject({ firstLedger: '128', nextLedger: '320' });
	});

	it('returns proof-pending and retries without ingesting unproven files', async () => {
		const range = await seedLinkedRange(
			'Historical proof pending network',
			[127, 191],
			1_130
		);
		await forwardPromoter.promote(range.at(-1)!.target);
		await dataSource.query(
			`update "history_archive_checkpoint_proof" set status = 'pending'
			 where id = $1`,
			[range[0]!.proofId]
		);
		const scheduled = await schedulerWithId(1_131).execute({
			checkpointCount: 1,
			maxAttempts: 1,
			networkPassphrase: range[0]!.target.networkPassphrase
		});
		if (!('job' in scheduled)) throw new Error('Expected a scheduled job');

		for (let cycle = 0; cycle < 12; cycle += 1) {
			await expect(
				worker(prepender).execute({
					...workerInput(range[0]!.target.networkPassphrase, workerOne),
					retryDelayMs: 0
				})
			).resolves.toMatchObject({
				checkpointLedger: 127,
				jobState: 'pending',
				processedCheckpoints: 0,
				status: 'proof-pending'
			});
		}
		await expect(batchCount(range[0]!.proofId)).resolves.toBe(0);
		await expect(
			backfillRepository.find(scheduled.job.id)
		).resolves.toMatchObject({
			attemptCount: 0,
			lastErrorCode: 'proof-pending',
			state: 'pending'
		});
	});

	it('reclaims an expired partially prepended range and resumes from the watermark', async () => {
		const range = await seedLinkedRange(
			'Historical crash recovery network',
			[191, 255, 319],
			1_140
		);
		await forwardPromoter.promote(range.at(-1)!.target);
		const scheduled = await schedulerWithId(1_141).execute({
			checkpointCount: 2,
			maxAttempts: 4,
			networkPassphrase: range[0]!.target.networkPassphrase
		});
		if (!('job' in scheduled)) throw new Error('Expected a scheduled job');
		const crashingPromoter: FullHistoryHistoricalCheckpointPromoter = {
			promote: async (target) => {
				const receipt = await prepender.promote(target);
				throw new Error(`simulated crash after ${receipt.firstLedger}`);
			}
		};
		await expect(
			worker(crashingPromoter).execute(
				workerInput(range[0]!.target.networkPassphrase, workerOne)
			)
		).rejects.toThrow(/simulated crash after 192/i);
		await expect(
			backfillRepository.findFrontier(range[0]!.target.networkPassphrase)
		).resolves.toMatchObject({ firstLedger: '192', nextLedger: '320' });
		await expireLease(scheduled.job.id);

		await expect(
			worker(prepender).execute(
				workerInput(range[0]!.target.networkPassphrase, workerTwo)
			)
		).resolves.toMatchObject({
			processedCheckpoints: 1,
			status: 'completed'
		});
		await expect(
			backfillRepository.find(scheduled.job.id)
		).resolves.toMatchObject({
			attemptCount: 2,
			state: 'completed'
		});
		await expect(
			backfillRepository.findFrontier(range[0]!.target.networkPassphrase)
		).resolves.toMatchObject({ firstLedger: '128', nextLedger: '320' });
	});

	function schedulerWithId(seed: number): ScheduleFullHistoryBackfill {
		return new ScheduleFullHistoryBackfill(backfillRepository, () =>
			fixtureUuid(seed)
		);
	}

	function worker(
		promoter: FullHistoryHistoricalCheckpointPromoter
	): RunFullHistoryBackfill {
		return new RunFullHistoryBackfill(backfillRepository, promoter);
	}

	async function seedLinkedRange(
		networkPassphrase: string,
		checkpoints: readonly number[],
		seedBase: number
	): Promise<SeededPromotionCandidate[]> {
		const candidates: SeededPromotionCandidate[] = [];
		for (const [index, checkpointLedger] of checkpoints.entries()) {
			candidates.push(
				await seedPromotionCandidate(dataSource, {
					checkpointLedger,
					networkPassphrase,
					seed: seedBase + index
				})
			);
		}
		for (let index = 1; index < candidates.length; index += 1) {
			await linkBoundary(candidates[index - 1]!, candidates[index]!);
		}
		return candidates;
	}

	async function linkBoundary(
		previous: SeededPromotionCandidate,
		current: SeededPromotionCandidate
	): Promise<void> {
		const previousHash = (await dataSource.query(
			`select header."ledgerHeaderHash" as hash
			 from "parsed_ledger_header_observation" observation
			 join "parsed_ledger_header" header
				on header.id = observation."parsedLedgerHeaderId"
			 where observation."sourceObjectRemoteId" = $1
				and header."ledgerSequence" = $2`,
			[previous.sourceIds.ledger, previous.target.checkpointLedger]
		)) as Array<{ readonly hash: string }>;
		const currentFirst = current.target.checkpointLedger - 63;
		await dataSource.query(
			`update "parsed_ledger_header" header
			 set "previousLedgerHeaderHash" = $1
			 from "parsed_ledger_header_observation" observation
			 where observation."parsedLedgerHeaderId" = header.id
				and observation."sourceObjectRemoteId" = $2
				and header."ledgerSequence" = $3`,
			[previousHash[0]?.hash, current.sourceIds.ledger, currentFirst]
		);
	}

	async function batchCount(proofId: number): Promise<number> {
		const rows = (await dataSource.query(
			`select count(*)::integer as count
			 from "full_history_ingestion_batch" where "checkpoint_proof_id" = $1`,
			[proofId]
		)) as Array<{ readonly count: number }>;
		return rows[0]?.count ?? -1;
	}

	async function expireLease(id: string): Promise<void> {
		await dataSource.query(
			`update "full_history_historical_backfill_job"
			 set "lease_expires_at" = now() - interval '1 second' where id = $1`,
			[id]
		);
	}
});

function workerInput(networkPassphrase: string, workerId: string) {
	return {
		leaseDurationMs: 60_000,
		maximumProofTargets: 4,
		networkPassphrase,
		retryDelayMs: 1_000,
		workerId
	} as const;
}

function fixtureUuid(value: number): string {
	return `00000000-0000-4000-8000-${value.toString().padStart(12, '0')}`;
}
