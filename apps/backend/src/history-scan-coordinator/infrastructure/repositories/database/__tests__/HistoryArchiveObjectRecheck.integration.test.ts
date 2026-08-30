import { DataSource } from 'typeorm';
import { HistoryArchiveObject } from '../../../../domain/history-archive-object/HistoryArchiveObject.js';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import { TypeOrmHistoryArchiveObjectRepository } from '../TypeOrmHistoryArchiveObjectRepository.js';
import {
	checkpointObject,
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
	});

	afterAll(async () => {
		if (dataSource?.isInitialized) await dataSource.destroy();
		if (postgres !== undefined) await postgres.stop();
	});

	beforeEach(async () => {
		await resetHistoryArchiveObjectQueue(dataSource);
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

	it('queues one explicit transport retry without changing its evidence', async () => {
		const object = remoteFailure('https://transport.example/archive');
		object.errorType = 'archive_transport_error';
		object.errorMessage = 'aborted';
		object.httpStatus = 200;
		await save(object);

		await expect(
			repository.requestObjectRecheck(object.remoteId)
		).resolves.toMatchObject({
			reason: 'eligible-remote-failure',
			remoteId: object.remoteId,
			state: 'queued'
		});

		expect(await repository.findByRemoteId(object.remoteId)).toMatchObject({
			errorMessage: 'aborted',
			errorType: 'archive_transport_error',
			failureChannel: 'archive_evidence',
			httpStatus: 200,
			status: 'failed'
		});
		await expect(readyRemoteIds()).resolves.toEqual([object.remoteId]);
	});

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

	it('returns not-yet-eligible without admitting a future retry', async () => {
		const object = remoteFailure('https://future.example/archive');
		object.nextAttemptAt = new Date(Date.now() + 60_000);
		await save(object);

		const result = await repository.requestObjectRecheck(object.remoteId);

		expect(result).toMatchObject({
			reason: 'retry-window',
			state: 'not-yet-eligible'
		});
		expect(result?.eligibleAt?.getTime()).toBe(object.nextAttemptAt.getTime());
		await expect(readyRemoteIds()).resolves.toEqual([]);
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
