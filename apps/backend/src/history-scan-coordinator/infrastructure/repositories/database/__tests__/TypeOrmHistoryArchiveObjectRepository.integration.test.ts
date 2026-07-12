import { DataSource } from 'typeorm';
import { mock } from 'jest-mock-extended';
import { HistoryArchiveObject } from '../../../../domain/history-archive-object/HistoryArchiveObject.js';
import type { HistoryArchiveCheckpointProofRepository } from '../../../../domain/history-archive-checkpoint-proof/HistoryArchiveCheckpointProofRepository.js';
import type { HistoryArchiveObjectEventRecorder } from '../../../../use-cases/record-history-archive-object-event/HistoryArchiveObjectEventRecorder.js';
import { FailHistoryArchiveObject } from '../../../../use-cases/fail-history-archive-object/FailHistoryArchiveObject.js';
import { HistoryArchiveObjectClaimCursorMigration1784780000000 } from '../../../database/migrations/1784780000000-HistoryArchiveObjectClaimCursorMigration.js';
import { TypeOrmHistoryArchiveObjectRepository } from '../TypeOrmHistoryArchiveObjectRepository.js';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import {
	bucketObject,
	categoryObject,
	checkpointObject,
	countHistoryArchiveHostThrottles,
	createObjectRepositoryDataSource,
	insertHistoryArchiveHostThrottle,
	resetHistoryArchiveObjectQueue as resetQueue,
	rootObject,
	saveHistoryArchiveObjects
} from './HistoryArchiveObjectRepositoryFixture.js';

jest.setTimeout(60_000);

describe('TypeOrmHistoryArchiveObjectRepository disposable PostgreSQL', () => {
	let dataSource: DataSource;
	let postgres: DisposablePostgres;
	let repository: TypeOrmHistoryArchiveObjectRepository;

	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		({ dataSource, repository } = await createObjectRepositoryDataSource(
			postgres.url
		));
	});

	afterAll(async () => {
		if (dataSource?.isInitialized) await dataSource.destroy();
		if (postgres !== undefined) await postgres.stop();
	});

	beforeEach(async () => {
		await resetQueue(dataSource);
	});

	it('rotates roots durably after released claims', async () => {
		await save(
			rootObject('https://same.example/archive-a'),
			rootObject('https://same.example/archive-b'),
			rootObject('https://third.example/archive-c')
		);

		const claims: HistoryArchiveObject[] = [];
		for (let index = 0; index < 3; index += 1) {
			const claim = await repository.claimNextObject(['history-archive-state']);
			if (claim === null) throw new Error('Expected a root claim');
			claims.push(claim);
			await repository.releaseObject(claim.remoteId, claim.attempts);
		}

		expect(new Set(claims.map((claim) => claim.archiveUrlIdentity)).size).toBe(
			3
		);
	});

	it('rotates equivalent object keys using the persistent object cursor', async () => {
		const archiveUrl = 'https://keys.example/archive';
		await save(
			rootObject(archiveUrl, 'verified'),
			checkpointObject(archiveUrl, 127),
			checkpointObject(archiveUrl, 191)
		);

		const first = await repository.claimNextObject(['checkpoint-state']);
		if (first === null) throw new Error('Expected the first checkpoint claim');
		await repository.releaseObject(first.remoteId, first.attempts);
		const second = await repository.claimNextObject(['checkpoint-state']);

		expect(second?.objectKey).not.toBe(first.objectKey);
		expect(new Set([first.objectKey, second?.objectKey])).toEqual(
			new Set(['checkpoint-state:0000007f', 'checkpoint-state:000000bf'])
		);
	});

	it('enforces the per-archive active cap', async () => {
		const archiveUrl = 'https://archive-cap.example/archive';
		const checkpoint = checkpointObject(archiveUrl, 127, 'verified');
		await save(
			rootObject(archiveUrl, 'verified'),
			checkpoint,
			categoryObject(archiveUrl, 127, 'ledger', 'scanning'),
			categoryObject(archiveUrl, 127, 'transactions'),
			rootObject('https://available.example/archive')
		);

		const claim = await repository.claimNextObject([
			'history-archive-state',
			'transactions'
		]);

		expect(claim?.archiveUrlIdentity).toBe('https://available.example/archive');
	});

	it('enforces the per-host active cap', async () => {
		await save(
			rootObject('https://host-cap.example/archive-a', 'scanning'),
			rootObject('https://host-cap.example/archive-b', 'scanning'),
			rootObject('https://host-cap.example/archive-c'),
			rootObject('https://available.example/archive')
		);

		const claim = await repository.claimNextObject(['history-archive-state']);

		expect(claim?.hostIdentity).toBe('available.example');
	});

	it('enforces the global active cap', async () => {
		await save(
			...Array.from({ length: 24 }, (_, index) =>
				rootObject(`https://active-${index}.example/archive`, 'scanning')
			),
			rootObject('https://pending.example/archive')
		);

		await expect(
			repository.claimNextObject(['history-archive-state'])
		).resolves.toBeNull();
	});

	it('claims failed objects only after their retry window is due', async () => {
		const object = rootObject('https://retry.example/archive', 'failed');
		object.nextAttemptAt = new Date(Date.now() + 60_000);
		await save(object);

		await expect(
			repository.claimNextObject(['history-archive-state'])
		).resolves.toBeNull();
		await dataSource.query(
			'update history_archive_object_queue set "nextAttemptAt" = now() - interval \'1 second\''
		);

		expect(
			(await repository.claimNextObject(['history-archive-state']))?.remoteId
		).toBe(object.remoteId);
	});

	it('does not reclaim failed objects before terminal effects reconcile', async () => {
		const object = rootObject('https://unreconciled.example/archive', 'failed');
		object.nextAttemptAt = new Date(Date.now() - 60_000);
		object.transitionEffectsRequiredAt = new Date();
		object.transitionEffectsCompletedAt = null;
		await save(object);

		await expect(
			repository.claimNextObject(['history-archive-state'])
		).resolves.toBeNull();
		await dataSource.query(
			`update history_archive_object_queue
			 set "transitionEffectsCompletedAt" = now()
			 where "remoteId" = $1`,
			[object.remoteId]
		);

		expect(
			(await repository.claimNextObject(['history-archive-state']))?.remoteId
		).toBe(object.remoteId);
	});

	it('releases stale scanning rows without changing pending rows', async () => {
		const stale = rootObject('https://stale.example/archive', 'scanning');
		stale.claimedAt = new Date('2026-01-01T00:00:00.000Z');
		stale.workerStage = 'downloading';
		const pending = rootObject('https://pending.example/archive');
		await save(stale, pending);
		await dataSource.query(
			'update history_archive_object_queue set "updatedAt" = $1 where "remoteId" = $2',
			[new Date('2026-01-01T00:00:00.000Z'), stale.remoteId]
		);

		expect(
			await repository.releaseStaleObjects(new Date('2026-01-02T00:00:00.000Z'))
		).toHaveLength(1);
		expect(await repository.findByRemoteId(stale.remoteId)).toMatchObject({
			claimedAt: null,
			status: 'pending',
			workerStage: null
		});
		expect((await repository.findByRemoteId(pending.remoteId))?.status).toBe(
			'pending'
		);
	});

	it('resumes a host after its durable throttle expires', async () => {
		const object = rootObject('https://throttled.example/archive');
		await save(object);
		await insertHostThrottle(
			'throttled.example',
			new Date(Date.now() + 60_000)
		);

		await expect(
			repository.claimNextObject(['history-archive-state'])
		).resolves.toBeNull();
		await dataSource.query(
			'update history_archive_object_host_throttle set "blockedUntil" = now() - interval \'1 second\''
		);

		expect(
			(await repository.claimNextObject(['history-archive-state']))?.remoteId
		).toBe(object.remoteId);
	});

	it('migration leaves legacy host state untouched', async () => {
		await dataSource.query(`
			insert into history_archive_object_host_throttle (
				"hostIdentity", "archiveUrlIdentity", "failureClass",
				"evidenceClass", "errorType", "httpStatus", "blockedUntil",
				"lastFailureAt", "consecutiveFailures", "createdAt", "updatedAt"
			) values (
				'worker.example', 'https://worker.example/archive', 'worker',
				'worker-infrastructure', 'worker_setup_failed', 503,
				now() + interval '1 hour', now(), 1, now(), now()
			)
		`);
		const queryRunner = dataSource.createQueryRunner();
		await new HistoryArchiveObjectClaimCursorMigration1784780000000().up(
			queryRunner
		);
		await queryRunner.release();

		expect(await throttleCount()).toBe(1);
	});

	it('commits object failure and eligible host throttle together', async () => {
		const failed = rootObject('https://pressure.example/archive', 'scanning');
		failed.attempts = 1;
		await save(failed);
		const useCase = new FailHistoryArchiveObject(
			repository,
			mock<HistoryArchiveObjectEventRecorder>(),
			mock<HistoryArchiveCheckpointProofRepository>()
		);

		const result = await useCase.execute(failed.remoteId, {
			claimAttempt: 1,
			errorMessage: 'HTTP 429 Too Many Requests',
			errorType: 'archive_http_error',
			failureChannel: 'archive_evidence',
			httpStatus: 429
		});

		expect(result._unsafeUnwrap()).toBe(true);
		expect((await repository.findByRemoteId(failed.remoteId))?.status).toBe(
			'failed'
		);
		expect(await throttleCount()).toBe(1);
	});

	it.each([
		['archive_http_error', 404, 'archive_evidence'],
		['category_verification_failed', null, 'archive_evidence'],
		['HASH_MISMATCH', 503, 'archive_evidence'],
		['worker_setup_failed', null, 'scanner_issue'],
		['coordinator_claim_failed', null, 'scanner_issue']
	] satisfies readonly (readonly [
		string,
		number | null,
		'archive_evidence' | 'scanner_issue'
	])[])(
		'does not host-throttle the non-host failure %s',
		async (errorType, httpStatus, failureChannel) => {
			const failed = rootObject(
				'https://non-host.example/archive-a',
				'scanning'
			);
			failed.attempts = 1;
			await save(failed, rootObject('https://non-host.example/archive-b'));
			const useCase = new FailHistoryArchiveObject(
				repository,
				mock<HistoryArchiveObjectEventRecorder>(),
				mock<HistoryArchiveCheckpointProofRepository>()
			);

			const result = await useCase.execute(failed.remoteId, {
				claimAttempt: 1,
				errorMessage: errorType,
				errorType,
				failureChannel,
				httpStatus
			});

			expect(result._unsafeUnwrap()).toBe(true);
			expect(await throttleCount()).toBe(0);
			expect(
				(await repository.claimNextObject(['history-archive-state']))
					?.archiveUrlIdentity
			).toBe('https://non-host.example/archive-b');
		}
	);

	it('blocks missing dependencies in claim and reports them only on pending rows', async () => {
		const archiveUrl = 'https://dependency.example/archive';
		const pending = checkpointObject(archiveUrl, 127);
		pending.dependencyReady = false;
		const failed = categoryObject(archiveUrl, 127, 'ledger', 'failed');
		failed.dependencyReady = false;
		await save(pending, failed);

		await expect(
			repository.claimNextObject(['checkpoint-state', 'ledger'])
		).resolves.toBeNull();
		const snapshot = await repository.getQueueSnapshot(10);
		expect(snapshot.pendingObjects).toBe(0);
		expect(
			snapshot.objects.find((object) => object.remoteId === pending.remoteId)
				?.delayReason?.code
		).toBe('missing-dependency');
		expect(
			snapshot.objects.find((object) => object.remoteId === failed.remoteId)
				?.delayReason
		).toBeNull();

		await save(rootObject(archiveUrl, 'verified'));
		pending.dependencyReady = true;
		await repository.planObjects([pending]);
		expect(
			(await repository.claimNextObject(['checkpoint-state']))?.remoteId
		).toBe(pending.remoteId);
	});

	it('treats null legacy pending disposition as deferred without mutating it', async () => {
		const deferred = rootObject('https://legacy-deferred.example/archive');
		deferred.executionDisposition = null;
		deferred.executionReason = null;
		const terminal = rootObject(
			'https://legacy-terminal.example/archive',
			'verified'
		);
		terminal.executionDisposition = null;
		await save(deferred, terminal);

		await expect(
			repository.claimNextObject(['history-archive-state'])
		).resolves.toBeNull();
		const snapshot = await repository.getQueueSnapshot(10);
		expect(
			snapshot.objects.find((object) => object.remoteId === deferred.remoteId)
				?.delayReason
		).toEqual({ code: 'legacy-deferred', until: null });
		expect(snapshot.pendingObjects).toBe(0);
		expect(
			snapshot.objects.find((object) => object.remoteId === terminal.remoteId)
				?.delayReason
		).toBeNull();
		expect(
			(await repository.findByRemoteId(deferred.remoteId))?.executionDisposition
		).toBeNull();
	});

	it('requires a verified checkpoint reference before claiming a bucket', async () => {
		const archiveUrl = 'https://bucket-dependency.example/archive';
		const hash = 'b'.repeat(64);
		const bucket = bucketObject(archiveUrl, hash);
		bucket.dependencyReady = false;
		await save(rootObject(archiveUrl, 'verified'), bucket);

		await expect(repository.claimNextObject(['bucket'])).resolves.toBeNull();
		const checkpoint = checkpointObject(archiveUrl, 127, 'verified');
		checkpoint.verificationFacts = {
			checkpointHistoryArchiveState: {
				stellarHistory: {
					currentBuckets: [
						{ curr: hash, next: { state: 0 }, snap: '0'.repeat(64) }
					]
				}
			}
		};
		await save(checkpoint);
		await repository.materializeCheckpointDependencies(checkpoint.remoteId);

		expect((await repository.claimNextObject(['bucket']))?.remoteId).toBe(
			bucket.remoteId
		);
	});

	it('persists Retry-After host state and does not erase it on success', async () => {
		const failed = rootObject(
			'https://retry-after.example/archive-a',
			'scanning'
		);
		failed.attempts = 1;
		const successful = rootObject(
			'https://retry-after.example/archive-b',
			'scanning'
		);
		successful.attempts = 1;
		await save(failed, successful);
		const useCase = new FailHistoryArchiveObject(
			repository,
			mock<HistoryArchiveObjectEventRecorder>(),
			mock<HistoryArchiveCheckpointProofRepository>()
		);

		expect(
			(
				await useCase.execute(failed.remoteId, {
					claimAttempt: 1,
					errorMessage: 'HTTP 429',
					errorType: 'archive_http_error',
					failureChannel: 'archive_evidence',
					httpStatus: 429,
					retryAfterSeconds: 900
				})
			)._unsafeUnwrap()
		).toBe(true);
		const [throttle] = (await dataSource.query(
			`select "blockedUntil", "retryAfterUntil"
			 from history_archive_object_host_throttle
			 where "hostIdentity" = 'retry-after.example'`
		)) as readonly {
			readonly blockedUntil: Date;
			readonly retryAfterUntil: Date;
		}[];
		expect(throttle?.retryAfterUntil.getTime()).toBeGreaterThan(
			Date.now() + 14 * 60_000
		);
		expect(throttle?.blockedUntil.getTime()).toBeGreaterThanOrEqual(
			throttle?.retryAfterUntil.getTime() ?? Infinity
		);

		await repository.markObjectVerified(successful.remoteId, {
			claimAttempt: 1
		});
		expect(await throttleCount()).toBe(1);
	});

	it('never returns the same row from concurrent claim attempts', async () => {
		await save(
			...Array.from({ length: 30 }, (_, index) =>
				rootObject(`https://concurrent-${index}.example/archive`)
			)
		);

		const claims = await Promise.all(
			Array.from({ length: 48 }, () =>
				repository.claimNextObject(['history-archive-state'])
			)
		);
		const claimedIds = claims.flatMap((claim) =>
			claim === null ? [] : [claim.remoteId]
		);
		const [{ count }] = (await dataSource.query(
			"select count(*)::int as count from history_archive_object_queue where status = 'scanning'"
		)) as Array<{ count: number }>;

		expect(claimedIds.length).toBeGreaterThan(0);
		expect(new Set(claimedIds).size).toBe(claimedIds.length);
		expect(count).toBe(claimedIds.length);
		expect(count).toBeLessThanOrEqual(24);
	});

	async function save(...objects: HistoryArchiveObject[]): Promise<void> {
		await saveHistoryArchiveObjects(dataSource, ...objects);
	}

	async function insertHostThrottle(
		hostIdentity: string,
		blockedUntil: Date
	): Promise<void> {
		await insertHistoryArchiveHostThrottle(
			dataSource,
			hostIdentity,
			blockedUntil
		);
	}

	async function throttleCount(): Promise<number> {
		return await countHistoryArchiveHostThrottles(dataSource);
	}
});
