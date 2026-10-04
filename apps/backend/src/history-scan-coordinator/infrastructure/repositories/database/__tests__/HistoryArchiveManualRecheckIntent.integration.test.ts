import type { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import { HistoryArchiveObject } from '../../../../domain/history-archive-object/HistoryArchiveObject.js';
import { HistoryArchiveManualRecheckIntentMigration1791088200000 } from '../../../database/migrations/1791088200000-HistoryArchiveManualRecheckIntentMigration.js';
import { HistoryArchiveBrokerFrontierRepository } from '../HistoryArchiveBrokerFrontierRepository.js';
import { requestHistoryArchiveObjectRecheck } from '../HistoryArchiveObjectRecheckWrite.js';
import {
	removeCompletedHistoryArchiveBrokerReadyRow,
	requeueFailedHistoryArchiveBrokerReadyRow
} from '../HistoryArchiveObjectReadyQueue.js';
import { historyArchiveManualOrAutomaticSourceRetrySql } from '../HistoryArchiveTransientSourceRetry.js';
import {
	createEvidenceObject,
	createKnownEvidenceDataSource,
	resetKnownEvidence
} from './KnownArchiveEvidenceRepositoryFixture.js';

jest.setTimeout(60_000);
describe('explicit manual intent fences definitive source retries', () => {
	let postgres: DisposablePostgres;
	let db: DataSource;
	let broker: HistoryArchiveBrokerFrontierRepository;
	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		db = await createKnownEvidenceDataSource(postgres.url);
		await db.query(`create table history_archive_object_ready (
			"objectRemoteId" uuid primary key, "archiveUrlIdentity" text not null,
			priority smallint not null, "availableAt" timestamptz not null,
			"dispatchToken" uuid, "claimAttempt" integer, "publishedAt" timestamptz,
			"createdAt" timestamptz not null default now(), "updatedAt" timestamptz not null)`);
		const runner = db.createQueryRunner();
		await new HistoryArchiveManualRecheckIntentMigration1791088200000().up(
			runner
		);
		await runner.release();
	});
	afterAll(async () => {
		if (db?.isInitialized) await db.destroy();
		if (postgres) await postgres.stop();
	});
	beforeEach(async () => {
		await db.query('truncate history_archive_object_ready');
		await resetKnownEvidence(db);
		broker = new HistoryArchiveBrokerFrontierRepository(db);
	});
	async function seed(key: string, priority = 2, manual = false) {
		const object = createEvidenceObject(
			'https://intent.example/history',
			`ledger:${key}`,
			'ledger',
			'failed'
		);
		Object.assign(object, {
			httpStatus: 404,
			errorType: 'archive_http_error',
			errorMessage: 'Not found',
			failureChannel: 'archive_availability',
			dependencyReady: true,
			executionDisposition: 'executable',
			attempts: 3
		});
		await db.getRepository(HistoryArchiveObject).save(object);
		await db.query(
			`insert into history_archive_object_ready
			("objectRemoteId","archiveUrlIdentity",priority,"availableAt","dispatchToken","recheckRequestedAt","updatedAt")
			values ($1,$2,$3,now(),$4,case when $5 then now() else null end,now())`,
			[
				object.remoteId,
				object.archiveUrlIdentity,
				priority,
				randomUUID(),
				manual
			]
		);
		return object;
	}
	async function ready(id: string) {
		const [row] = (await db.query(
			'select * from history_archive_object_ready where "objectRemoteId"=$1',
			[id]
		)) as {
			dispatchToken: string;
			claimAttempt: number | null;
			recheckRequestedAt: Date | null;
			publishedAt: Date | null;
		}[];
		return row;
	}
	it.each([0, 2])(
		'parks old automatic tokens at priority %i without erasing source evidence',
		async (priority) => {
			const object = await seed('automatic', priority);
			expect(await broker.reserveJobs(8, 8)).toEqual([]);
			expect(
				await db
					.getRepository(HistoryArchiveObject)
					.findOneByOrFail({ remoteId: object.remoteId })
			).toMatchObject({
				status: 'failed',
				attempts: 3,
				httpStatus: 404,
				errorMessage: 'Not found'
			});
			expect((await ready(object.remoteId))?.recheckRequestedAt).toBeNull();
		}
	);
	it('distinguishes manual and automatic tokens at the same priority', async () => {
		await seed('automatic', 2);
		const manual = await seed('manual', 2, true);
		const jobs = await broker.reserveJobs(8, 8);
		expect(jobs.map((row) => row.job.remoteId)).toEqual([manual.remoteId]);
		expect(jobs[0]?.job.claimAttempt).toBe(4);
	});
	it('confirms an ambiguous unpublished token only after an explicit request', async () => {
		const object = await seed('confirm');
		const token = (await ready(object.remoteId))?.dispatchToken;
		expect(
			await requestHistoryArchiveObjectRecheck(
				db.getRepository(HistoryArchiveObject),
				object.remoteId
			)
		).toMatchObject({ state: 'already-queued' });
		expect(await ready(object.remoteId)).toMatchObject({
			dispatchToken: token,
			recheckRequestedAt: expect.any(Date)
		});
		expect((await broker.reserveJobs(1, 8))[0]?.job.remoteId).toBe(
			object.remoteId
		);
	});
	it('does not retag a published execution as manual', async () => {
		const object = await seed('published');
		await db.query(
			'update history_archive_object_ready set "publishedAt"=now(),"claimAttempt"=4 where "objectRemoteId"=$1',
			[object.remoteId]
		);
		await requestHistoryArchiveObjectRecheck(
			db.getRepository(HistoryArchiveObject),
			object.remoteId
		);
		expect((await ready(object.remoteId))?.recheckRequestedAt).toBeNull();
	});
	it('replays only the explicit manual execution and clears its intent if orphaned', async () => {
		const automatic = await seed('automatic-published');
		const manual = await seed('manual-published', 2, true);
		await db.query(
			'update history_archive_object_ready set "publishedAt"=now(),"claimAttempt"=4'
		);
		expect(
			(await broker.findPublishedJobs(8)).map((job) => job.job.remoteId)
		).toEqual([manual.remoteId]);
		expect(
			await broker.requeueOrphanedPublishedJobs(new Date(Date.now() + 1000), 8)
		).toBe(2);
		for (const object of [automatic, manual])
			expect(await ready(object.remoteId)).toMatchObject({
				recheckRequestedAt: null,
				dispatchToken: null,
				claimAttempt: null,
				publishedAt: null
			});
		expect(await broker.reserveJobs(8, 8)).toEqual([]);
	});
	it('writes explicit intent when the user requests a new ready row', async () => {
		const object = await seed('new-manual');
		await db.query(
			'delete from history_archive_object_ready where "objectRemoteId"=$1',
			[object.remoteId]
		);
		expect(
			await requestHistoryArchiveObjectRecheck(
				db.getRepository(HistoryArchiveObject),
				object.remoteId
			)
		).toMatchObject({ state: 'queued' });
		expect((await ready(object.remoteId))?.recheckRequestedAt).toEqual(
			expect.any(Date)
		);
	});
	it('cannot reuse an already consumed manual attempt, including a pending reset', async () => {
		const object = await seed('consumed', 2, true);
		await db.query(
			'update history_archive_object_ready set "claimAttempt"=3 where "objectRemoteId"=$1',
			[object.remoteId]
		);
		await db.query(
			'update history_archive_object_queue set status=\'pending\' where "remoteId"=$1',
			[object.remoteId]
		);
		expect(await broker.reserveJobs(1, 8)).toEqual([]);
	});
	it('clears manual intent on automatic failure reset but rejects a mismatched execution fence', async () => {
		const object = await seed('reset', 2, true);
		const [job] = await broker.reserveJobs(1, 8);
		if (!job) throw new Error('Expected manual reservation');
		await requeueFailedHistoryArchiveBrokerReadyRow(
			db.manager,
			object.remoteId,
			randomUUID(),
			4,
			new Date()
		);
		expect((await ready(object.remoteId))?.recheckRequestedAt).not.toBeNull();
		await requeueFailedHistoryArchiveBrokerReadyRow(
			db.manager,
			object.remoteId,
			job.executionId,
			4,
			new Date()
		);
		expect(await ready(object.remoteId)).toMatchObject({
			recheckRequestedAt: null,
			dispatchToken: null,
			claimAttempt: null,
			publishedAt: null
		});
		expect(await broker.reserveJobs(1, 8)).toEqual([]);
	});
	it('removes manual intent only for matching completed execution', async () => {
		const object = await seed('complete', 2, true);
		const [job] = await broker.reserveJobs(1, 8);
		if (!job) throw new Error('Expected manual reservation');
		await removeCompletedHistoryArchiveBrokerReadyRow(
			db.manager,
			object.remoteId,
			randomUUID(),
			4
		);
		expect(await ready(object.remoteId)).toBeDefined();
		await removeCompletedHistoryArchiveBrokerReadyRow(
			db.manager,
			object.remoteId,
			job.executionId,
			4
		);
		expect(await ready(object.remoteId)).toBeUndefined();
	});
	it.each([408, 425, 429, 500])(
		'preserves transient HTTP %i admission without manual intent',
		async (status) => {
			const object = await seed('transient', 0);
			await db.query(
				'update history_archive_object_queue set "httpStatus"=$2 where "remoteId"=$1',
				[object.remoteId, status]
			);
			expect((await broker.reserveJobs(1, 8))[0]?.job.remoteId).toBe(
				object.remoteId
			);
		}
	);
	it('rejects invalid SQL aliases', () =>
		expect(() =>
			historyArchiveManualOrAutomaticSourceRetrySql('object', 'ready; drop')
		).toThrow('Invalid ready SQL alias'));
});
