import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { cleanupReadyObjectsSql } from '../HistoryArchiveObjectReadyQueue.js';
import { historyArchiveReadyMutableEligibilitySql } from '../HistoryArchiveReadyCandidatesSql.js';
import { HistoryArchiveObject } from '../../../../domain/history-archive-object/HistoryArchiveObject.js';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import { TypeOrmHistoryArchiveObjectRepository } from '../TypeOrmHistoryArchiveObjectRepository.js';
import {
	checkpointObject,
	categoryObject,
	createObjectRepositoryDataSource,
	insertHistoryArchiveHostThrottle,
	resetHistoryArchiveObjectQueue,
	rootObject
} from './HistoryArchiveObjectRepositoryFixture.js';

jest.setTimeout(60_000);

describe('history archive object recheck persistence', () => {
	let dataSource: DataSource;
	let postgres: DisposablePostgres;
	let repository: TypeOrmHistoryArchiveObjectRepository;

	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		({ dataSource, repository } = await createObjectRepositoryDataSource(
			postgres.url
		));
		await dataSource.query(`create table history_archive_checkpoint_scan_cursor (
			"archiveUrlIdentity" text primary key, "nextHistoricalCheckpointLedger" integer)`);
	});

	afterAll(async () => {
		if (dataSource?.isInitialized) await dataSource.destroy();
		if (postgres !== undefined) await postgres.stop();
	});

	beforeEach(async () => {
		await resetHistoryArchiveObjectQueue(dataSource);
		await dataSource.query('truncate history_archive_checkpoint_scan_cursor');
	});

	it('retains a fenced interrupted retry outside the current cohort without erasing evidence or bypassing transitions', async () => {
		const object = categoryObject(
			'https://interrupted.example/archive',
			127,
			'ledger'
		);
		object.executionDisposition = 'executable';
		object.dependencyReady = true;
		const unrelated = rootObject('https://new-work.example/archive');
		unrelated.executionDisposition = 'executable';
		unrelated.dependencyReady = true;
		await dataSource
			.getRepository(HistoryArchiveObject)
			.save([object, unrelated]);
		await dataSource.query(
			'insert into history_archive_checkpoint_scan_cursor values ($1, 63999)',
			[object.archiveUrlIdentity]
		);
		const executionId = randomUUID();
		await dataSource.query(
			`insert into history_archive_object_ready (
			"objectRemoteId", "archiveUrlIdentity", priority, "availableAt",
			"dispatchToken", "claimAttempt", "publishedAt", "createdAt", "updatedAt"
		) values ($1,$2,2,now(),$3,1,now(),now(),now()),
			($4,$5,0,now(),null,null,null,now(),now())`,
			[
				object.remoteId,
				object.archiveUrlIdentity,
				executionId,
				unrelated.remoteId,
				unrelated.archiveUrlIdentity
			]
		);
		const failure = {
			claimAttempt: 1,
			executionId,
			scheduler: 'broker' as const,
			errorType: 'ERR_CANCELED',
			errorMessage: 'aborted',
			httpStatus: 200,
			failureChannel: 'archive_evidence' as const,
			nextAttemptAt: new Date(Date.now() + 60_000)
		};
		await expect(
			repository.markObjectFailed(object.remoteId, {
				...failure,
				executionId: randomUUID()
			})
		).resolves.toBe(false);
		await expect(
			repository.markObjectFailed(object.remoteId, failure)
		).resolves.toBe(true);
		await expect(
			repository.markObjectFailed(object.remoteId, failure)
		).resolves.toBe(false);
		await dataSource.query(cleanupReadyObjectsSql);
		expect(await readyRemoteIds()).toEqual(
			[object.remoteId, unrelated.remoteId].sort()
		);
		expect(await repository.findByRemoteId(object.remoteId)).toMatchObject({
			status: 'failed',
			attempts: 1,
			errorType: 'ERR_CANCELED',
			errorMessage: 'aborted',
			httpStatus: 200,
			failureChannel: 'archive_evidence'
		});
		const eligibleSql = `select candidate."remoteId" from history_archive_object_queue candidate
			where candidate."remoteId" = $1 and ${historyArchiveReadyMutableEligibilitySql('candidate')}`;
		expect(await dataSource.query(eligibleSql, [object.remoteId])).toEqual([]);
		await dataSource.query(
			`update history_archive_object_queue set "nextAttemptAt" = now() - interval '1 second',
			"transitionEffectsCompletedAt" = now() where "remoteId" = $1`,
			[object.remoteId]
		);
		await dataSource.query(
			`update history_archive_object_ready set "availableAt" = now() - interval '1 second'
			where "objectRemoteId" = $1`,
			[object.remoteId]
		);
		await dataSource.query(cleanupReadyObjectsSql);
		expect(await dataSource.query(eligibleSql, [object.remoteId])).toEqual([
			{ remoteId: object.remoteId }
		]);
	});

	it('queues the exact eligible failure once without resetting its evidence', async () => {
		const object = remoteFailure('https://recheck.example/archive');
		object.attempts = 3;
		object.errorType = 'BUCKET_HASH_MISMATCH';
		object.errorMessage = 'Remote bytes did not match the bucket hash.';
		await save(object);
		const persistedEvidence = await repository.findByRemoteId(object.remoteId);
		if (persistedEvidence?.updatedAt === undefined) {
			throw new Error('Expected persisted evidence timestamp');
		}

		await expect(
			repository.requestObjectRecheck(
				object.remoteId,
				new Date(persistedEvidence.updatedAt.getTime() - 1)
			)
		).resolves.toMatchObject({
			reason: 'evidence-revision-changed',
			state: 'blocked'
		});
		await expect(readyRemoteIds()).resolves.toEqual([]);

		await expect(
			repository.requestObjectRecheck(
				object.remoteId,
				persistedEvidence.updatedAt
			)
		).resolves.toMatchObject({
			reason: 'eligible-remote-failure',
			remoteId: object.remoteId,
			state: 'queued'
		});
		await expect(
			repository.requestObjectRecheck(object.remoteId)
		).resolves.toMatchObject({
			reason: 'already-in-ready-queue',
			state: 'already-queued'
		});

		const stored = await repository.findByRemoteId(object.remoteId);
		expect(stored).toMatchObject({
			attempts: 3,
			errorMessage: 'Remote bytes did not match the bucket hash.',
			errorType: 'BUCKET_HASH_MISMATCH',
			failureChannel: 'archive_evidence',
			status: 'failed'
		});
		await expect(readyRemoteIds()).resolves.toEqual([object.remoteId]);
	});

	it.each(['archive_evidence', 'scanner_issue'] as const)(
		'queues one explicit %s transport retry without changing its evidence',
		async (failureChannel) => {
			const object = remoteFailure('https://transport.example/archive');
			object.errorType = 'archive_transport_error';
			object.errorMessage = 'aborted';
			object.httpStatus = 200;
			object.failureChannel = failureChannel;
			object.attempts = 12;
			await save(object);

			await expect(
				repository.requestObjectRecheck(object.remoteId)
			).resolves.toMatchObject({
				reason: 'eligible-remote-failure',
				remoteId: object.remoteId,
				state: 'queued'
			});

			expect(await repository.findByRemoteId(object.remoteId)).toMatchObject({
				attempts: 12,
				errorMessage: 'aborted',
				errorType: 'archive_transport_error',
				failureChannel,
				httpStatus: 200,
				status: 'failed'
			});
			await expect(readyRemoteIds()).resolves.toEqual([object.remoteId]);
		}
	);

	it('queues explicit retries independently for the same archive root', async () => {
		const archiveUrl = 'https://same-root.example/archive';
		const first = remoteFailure(archiveUrl);
		const second = checkpointObject(archiveUrl, 63, 'failed');
		second.failureChannel = 'archive_evidence';
		second.errorMessage = 'SB Connection time-out';
		second.errorType = 'archive_transport_error';
		second.nextAttemptAt = new Date(Date.now() - 60_000);
		await save(first, second);

		await expect(
			repository.requestObjectRecheck(first.remoteId)
		).resolves.toMatchObject({ state: 'queued' });
		await expect(
			repository.requestObjectRecheck(second.remoteId)
		).resolves.toMatchObject({ state: 'queued' });
		await expect(readyRemoteIds()).resolves.toEqual(
			[first.remoteId, second.remoteId].sort()
		);
	});

	it('lets an explicit manual request bypass an object retry window', async () => {
		const object = remoteFailure('https://future.example/archive');
		object.nextAttemptAt = new Date(Date.now() + 60_000);
		await save(object);

		const result = await repository.requestObjectRecheck(object.remoteId);

		expect(result).toMatchObject({
			reason: 'eligible-remote-failure',
			state: 'queued'
		});
		expect(result?.eligibleAt?.getTime()).toBe(object.nextAttemptAt.getTime());
		await expect(readyRemoteIds()).resolves.toEqual([object.remoteId]);
	});

	it('respects active host backoff without admitting the object', async () => {
		const object = remoteFailure('https://backoff.example/archive');
		const blockedUntil = new Date(Date.now() + 120_000);
		await save(object);
		await insertHistoryArchiveHostThrottle(
			dataSource,
			object.hostIdentity,
			blockedUntil
		);

		const result = await repository.requestObjectRecheck(object.remoteId);

		expect(result).toMatchObject({ reason: 'host-backoff', state: 'blocked' });
		expect(result?.blockedUntil?.getTime()).toBe(blockedUntil.getTime());
		await expect(readyRemoteIds()).resolves.toEqual([]);
	});

	it('rejects scanner failures and never resets verified objects', async () => {
		const scannerFailure = remoteFailure(
			'https://scanner-failure.example/archive'
		);
		scannerFailure.failureChannel = 'scanner_issue';
		scannerFailure.errorType = 'SCANNER_CONFIGURATION_ERROR';
		scannerFailure.errorMessage = 'Missing scanner configuration';
		const verified = rootObject('https://verified.example/archive', 'verified');
		verified.verifiedAt = new Date();
		await save(scannerFailure, verified);

		await expect(
			repository.requestObjectRecheck(scannerFailure.remoteId)
		).resolves.toMatchObject({
			reason: 'non-remote-evidence-failure',
			state: 'blocked'
		});
		await expect(
			repository.requestObjectRecheck(verified.remoteId)
		).resolves.toMatchObject({ reason: 'verified-object', state: 'blocked' });
		expect((await repository.findByRemoteId(verified.remoteId))?.status).toBe(
			'verified'
		);
		await expect(readyRemoteIds()).resolves.toEqual([]);
	});

	function remoteFailure(archiveUrl: string): HistoryArchiveObject {
		const object = rootObject(archiveUrl, 'failed');
		object.failureChannel = 'archive_evidence';
		object.errorMessage = 'SB Connection time-out';
		object.errorType = 'archive_transport_error';
		object.nextAttemptAt = new Date(Date.now() - 60_000);
		return object;
	}

	async function save(...objects: HistoryArchiveObject[]): Promise<void> {
		await dataSource.getRepository(HistoryArchiveObject).save(objects);
	}

	async function readyRemoteIds(): Promise<readonly string[]> {
		const rows = (await dataSource.query(
			'select "objectRemoteId" from history_archive_object_ready order by "objectRemoteId"'
		)) as readonly { readonly objectRemoteId: string }[];
		return rows.map((row) => row.objectRemoteId);
	}
});
