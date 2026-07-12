import { DataSource } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import { fullHistoryHistoricalBackfillRange } from '../../../../domain/full-history-backfill/FullHistoryHistoricalBackfill.js';
import { TypeOrmFullHistoryHistoricalBackfillRepository } from '../TypeOrmFullHistoryHistoricalBackfillRepository.js';
import { TypeOrmFullHistoryCanonicalRepository } from '../../full-history/TypeOrmFullHistoryCanonicalRepository.js';
import {
	fullHistoryEntities,
	installFullHistoryCanonicalSchema,
	seedFullHistoryCheckpoint
} from '../../full-history/__tests__/FullHistoryCanonicalFixture.js';
import { FullHistoryHistoricalBackfillMigration1784940000000 } from '../../migrations/1784940000000-FullHistoryHistoricalBackfillMigration.js';

jest.setTimeout(60_000);

const networkPassphrase = 'Historical repository network';
const workerOne = '00000000-0000-4000-8000-000000009201';
const workerTwo = '00000000-0000-4000-8000-000000009202';
const workerThree = '00000000-0000-4000-8000-000000009203';

describe('TypeOrmFullHistoryHistoricalBackfillRepository', () => {
	let dataSource: DataSource;
	let postgres: DisposablePostgres;
	let repository: TypeOrmFullHistoryHistoricalBackfillRepository;

	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		dataSource = new DataSource({
			entities: fullHistoryEntities,
			type: 'postgres',
			url: postgres.url
		});
		await dataSource.initialize();
		await installFullHistoryCanonicalSchema(dataSource);
		const canonicalRepository = new TypeOrmFullHistoryCanonicalRepository(
			dataSource
		);
		const current = await seedFullHistoryCheckpoint(dataSource, {
			batchNumber: 920,
			checkpointLedger: 319,
			networkPassphrase
		});
		await canonicalRepository.writeCheckpoint(current);
		const runner = dataSource.createQueryRunner();
		await runner.connect();
		await runner.startTransaction();
		await new FullHistoryHistoricalBackfillMigration1784940000000().up(runner);
		await runner.commitTransaction();
		await runner.release();
		repository = new TypeOrmFullHistoryHistoricalBackfillRepository(dataSource);
	});

	beforeEach(async () => {
		await dataSource.query('truncate "full_history_historical_backfill_job"');
	});

	afterAll(async () => {
		if (dataSource?.isInitialized) await dataSource.destroy();
		if (postgres !== undefined) await postgres.stop();
	});

	it('schedules exact ranges idempotently and rejects overlap or oversized work', async () => {
		const range = fullHistoryHistoricalBackfillRange(255n, 255n);
		const [left, right] = await Promise.all([
			repository.schedule({
				id: '00000000-0000-4000-8000-000000009211',
				maxAttempts: 4,
				networkPassphrase,
				range
			}),
			repository.schedule({
				id: '00000000-0000-4000-8000-000000009212',
				maxAttempts: 4,
				networkPassphrase,
				range
			})
		]);
		expect([left.created, right.created].sort()).toEqual([false, true]);
		expect(left.job.id).toBe(right.job.id);
		await expect(
			repository.schedule({
				id: '00000000-0000-4000-8000-000000009213',
				maxAttempts: 4,
				networkPassphrase,
				range: fullHistoryHistoricalBackfillRange(191n, 255n)
			})
		).rejects.toThrow(/must not overlap/i);
		expect(() => fullHistoryHistoricalBackfillRange(63n, 575n)).toThrow(
			/checkpointCount/i
		);
		await expect(
			repository.schedule({
				id: '00000000-0000-4000-8000-000000009214',
				maxAttempts: 4,
				networkPassphrase,
				range: fullHistoryHistoricalBackfillRange(319n, 319n)
			})
		).rejects.toThrow(/immediately below the lower frontier/i);
		await expect(
			repository.schedule({
				id: '00000000-0000-4000-8000-000000009215',
				maxAttempts: 4,
				networkPassphrase,
				range: fullHistoryHistoricalBackfillRange(191n, 191n)
			})
		).rejects.toThrow(/immediately below the lower frontier/i);
	});

	it('claims one adjacent bounded job once and keeps a worker claim idempotent', async () => {
		const adjacent = await scheduleAdjacent(9_221);
		const [first, second] = await Promise.all([
			repository.claim({
				leaseDurationMs: 60_000,
				networkPassphrase,
				workerId: workerOne
			}),
			repository.claim({
				leaseDurationMs: 60_000,
				networkPassphrase,
				workerId: workerTwo
			})
		]);
		const claimed = [first, second].filter((job) => job !== null);
		expect(claimed).toHaveLength(1);
		expect(claimed[0]).toMatchObject({
			attemptCount: 1,
			id: adjacent.job.id,
			state: 'leased'
		});
		const owner = first === null ? workerTwo : workerOne;
		const replay = await repository.claim({
			leaseDurationMs: 60_000,
			networkPassphrase,
			workerId: owner
		});
		expect(replay?.leaseToken).toBe(claimed[0]!.leaseToken);
		expect(replay?.attemptCount).toBe(1);
	});

	it('recovers expired leases, rejects stale owners, and applies durable retry bounds', async () => {
		const scheduled = await repository.schedule({
			id: '00000000-0000-4000-8000-000000009231',
			maxAttempts: 3,
			networkPassphrase,
			range: fullHistoryHistoricalBackfillRange(255n, 255n)
		});
		const first = await requiredClaim(workerOne);
		await expireLease(scheduled.job.id);
		const second = await requiredClaim(workerTwo);
		expect(second.attemptCount).toBe(2);
		expect(second.leaseToken).not.toBe(first.leaseToken);
		await expect(
			repository.retry({
				errorCode: 'stale-worker',
				id: first.id,
				leaseToken: first.leaseToken!,
				retryDelayMs: 0,
				workerId: workerOne
			})
		).rejects.toThrow(/not owned/i);

		const pending = await repository.retry({
			errorCode: 'source-unavailable',
			id: second.id,
			leaseToken: second.leaseToken!,
			retryDelayMs: 60_000,
			workerId: workerTwo
		});
		expect(pending).toMatchObject({
			attemptCount: 2,
			lastErrorCode: 'source-unavailable',
			state: 'pending'
		});
		await expect(requiredClaim(workerThree)).rejects.toThrow(/claimable/i);
		await makeAvailable(scheduled.job.id);
		const final = await requiredClaim(workerThree);
		expect(final.attemptCount).toBe(3);
		const failed = await repository.retry({
			errorCode: 'source-invalid',
			id: final.id,
			leaseToken: final.leaseToken!,
			retryDelayMs: 0,
			workerId: workerThree
		});
		expect(failed.state).toBe('failed');
		await expect(repository.find(final.id)).resolves.toMatchObject({
			attemptCount: 3,
			state: 'failed'
		});
	});

	it('waits durably for proof without exhausting failure attempts', async () => {
		const scheduled = await repository.schedule({
			id: '00000000-0000-4000-8000-000000009235',
			maxAttempts: 1,
			networkPassphrase,
			range: fullHistoryHistoricalBackfillRange(255n, 255n)
		});
		for (let cycle = 0; cycle < 12; cycle += 1) {
			const claimed = await requiredClaim(workerOne);
			expect(claimed).toMatchObject({ attemptCount: 1, state: 'leased' });
			const waiting = await repository.waitForProof({
				id: claimed.id,
				leaseToken: requiredLeaseToken(claimed.leaseToken),
				retryDelayMs: 0,
				workerId: workerOne
			});
			expect(waiting).toMatchObject({
				attemptCount: 0,
				lastErrorCode: 'proof-pending',
				state: 'pending'
			});
		}
		await expect(repository.find(scheduled.job.id)).resolves.toMatchObject({
			attemptCount: 0,
			state: 'pending'
		});

		const claimed = await requiredClaim(workerOne);
		const failed = await repository.retry({
			errorCode: 'evidence-invalid-proof',
			id: claimed.id,
			leaseToken: requiredLeaseToken(claimed.leaseToken),
			retryDelayMs: 0,
			workerId: workerOne
		});
		expect(failed).toMatchObject({ attemptCount: 1, state: 'failed' });
	});

	it('fails an expired final-attempt lease instead of stranding it', async () => {
		const scheduled = await repository.schedule({
			id: '00000000-0000-4000-8000-000000009241',
			maxAttempts: 1,
			networkPassphrase,
			range: fullHistoryHistoricalBackfillRange(255n, 255n)
		});
		await requiredClaim(workerOne);
		await expireLease(scheduled.job.id);
		await expect(
			repository.claim({
				leaseDurationMs: 60_000,
				networkPassphrase,
				workerId: workerTwo
			})
		).resolves.toBeNull();
		await expect(repository.find(scheduled.job.id)).resolves.toMatchObject({
			attemptCount: 1,
			lastErrorCode: 'lease-exhausted',
			state: 'failed'
		});
	});

	it('returns the lower and forward frontiers without conflating them', async () => {
		await expect(
			repository.findFrontier(networkPassphrase)
		).resolves.toMatchObject({
			firstLedger: '256',
			nextLedger: '320'
		});
	});

	async function scheduleAdjacent(batch: number) {
		return repository.schedule({
			id: `00000000-0000-4000-8000-${batch.toString().padStart(12, '0')}`,
			maxAttempts: 4,
			networkPassphrase,
			range: fullHistoryHistoricalBackfillRange(255n, 255n)
		});
	}

	async function requiredClaim(workerId: string) {
		const job = await repository.claim({
			leaseDurationMs: 60_000,
			networkPassphrase,
			workerId
		});
		if (job === null) throw new Error('Expected a claimable historical job');
		return job;
	}

	async function expireLease(id: string): Promise<void> {
		await dataSource.query(
			`update "full_history_historical_backfill_job"
			 set "lease_expires_at" = now() - interval '1 second' where id = $1`,
			[id]
		);
	}

	async function makeAvailable(id: string): Promise<void> {
		await dataSource.query(
			`update "full_history_historical_backfill_job"
			 set "available_at" = now() - interval '1 second' where id = $1`,
			[id]
		);
	}
});

function requiredLeaseToken(value: string | null): string {
	if (value === null) throw new Error('Expected a leased job token');
	return value;
}
