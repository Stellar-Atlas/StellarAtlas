import type { DataSource, EntityManager } from 'typeorm';
import { randomUUID } from 'node:crypto';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import { HistoryArchiveObject } from '../../../../domain/history-archive-object/HistoryArchiveObject.js';
import { reconcileHistoryArchivePhaseSuppressedReservations } from '../HistoryArchivePhaseSuppressedReservation.js';
import {
	createEvidenceObject,
	createKnownEvidenceDataSource,
	resetKnownEvidence
} from './KnownArchiveEvidenceRepositoryFixture.js';

jest.setTimeout(60_000);
describe('phase-suppressed publication reconciliation', () => {
	let postgres: DisposablePostgres;
	let db: DataSource;
	const oldPhase = process.env.HISTORY_ARCHIVE_RETRY_PHASE;
	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		db = await createKnownEvidenceDataSource(postgres.url);
		await db.query(`create table history_archive_object_ready (
			"objectRemoteId" uuid primary key,"archiveUrlIdentity" text not null,
			priority smallint not null,"availableAt" timestamptz not null,
			"dispatchToken" uuid,"claimAttempt" integer,"publishedAt" timestamptz,
			"recheckRequestedAt" timestamptz,"updatedAt" timestamptz not null)`);
	});
	afterAll(async () => {
		if (db?.isInitialized) await db.destroy();
		if (postgres) await postgres.stop();
		if (oldPhase === undefined) delete process.env.HISTORY_ARCHIVE_RETRY_PHASE;
		else process.env.HISTORY_ARCHIVE_RETRY_PHASE = oldPhase;
	});
	beforeEach(async () => {
		process.env.HISTORY_ARCHIVE_RETRY_PHASE = 'first-pass';
		await db.query('truncate history_archive_object_ready');
		await resetKnownEvidence(db);
	});
	async function seed(
		status: 'pending' | 'failed' = 'failed',
		attempts = 5,
		manual = false
	) {
		const object = createEvidenceObject(
			'https://phase.example/history',
			randomUUID(),
			'transactions',
			status
		);
		object.checkpointLedger = 63;
		object.executionDisposition = 'executable';
		object.dependencyReady = true;
		object.attempts = attempts;
		object.httpStatus = status === 'failed' ? 404 : null;
		object.errorType = status === 'failed' ? 'archive_http_error' : null;
		object.errorMessage = status === 'failed' ? 'HTTP 404' : null;
		await db.getRepository(HistoryArchiveObject).save(object);
		const token = randomUUID();
		await db.query(
			`insert into history_archive_object_ready values($1,$2,0,now(),$3,$4,'2001-01-01T00:00:00.123456Z',$5,now())`,
			[
				object.remoteId,
				object.archiveUrlIdentity,
				token,
				attempts + 1,
				manual ? new Date() : null
			]
		);
		return { object, token };
	}
	const snapshot =
		(tokens: string[] = [], confirm = true) =>
		async () => ({
			executionIds: new Set(tokens),
			confirmUnchanged: async () => confirm
		});
	const run = (read: ReturnType<typeof snapshot>, limit = 120) =>
		db.transaction((manager) =>
			reconcileHistoryArchivePhaseSuppressedReservations(
				manager,
				new Date(),
				limit,
				read
			)
		);
	it('releases only absent forbidden executions and preserves all queue evidence', async () => {
		const absent = await seed();
		const live = await seed();
		const before = await db
			.getRepository(HistoryArchiveObject)
			.findOneByOrFail({ remoteId: absent.object.remoteId });
		expect(await run(snapshot([live.token]))).toBe(1);
		const ready = await db.query(
			`select "dispatchToken","claimAttempt","publishedAt" from history_archive_object_ready where "objectRemoteId"=$1`,
			[absent.object.remoteId]
		);
		expect(ready[0]).toEqual({
			dispatchToken: null,
			claimAttempt: null,
			publishedAt: null
		});
		expect(
			await db
				.getRepository(HistoryArchiveObject)
				.findOneByOrFail({ remoteId: absent.object.remoteId })
		).toEqual(before);
		expect(
			(
				await db.query(
					`select "dispatchToken" from history_archive_object_ready where "objectRemoteId"=$1`,
					[live.object.remoteId]
				)
			)[0].dispatchToken
		).toBe(live.token);
	});
	it('never expires manual, fresh, metadata or eligible work by age', async () => {
		await seed('pending', 0);
		const metadata = await seed();
		await db.query(
			`update history_archive_object_queue set "objectType"='history-archive-state' where "remoteId"=$1`,
			[metadata.object.remoteId]
		);
		await seed('failed', 5, true);
		const read = jest.fn(snapshot());
		expect(await run(read)).toBe(0);
		expect(read).not.toHaveBeenCalled();
	});
	it('is disabled in recheck phase and does not inspect the broker', async () => {
		await seed();
		process.env.HISTORY_ARCHIVE_RETRY_PHASE = 'recheck';
		const read = jest.fn(snapshot());
		expect(await run(read)).toBe(0);
		expect(read).not.toHaveBeenCalled();
	});
	it.each(['absent-snapshot', 'changed-sequence'])(
		'leaves exact publication intact for %s',
		async (reason) => {
			const job = await seed();
			const read =
				reason === 'absent-snapshot' ? async () => null : snapshot([], false);
			expect(
				await db.transaction((manager) =>
					reconcileHistoryArchivePhaseSuppressedReservations(
						manager,
						new Date(),
						120,
						read
					)
				)
			).toBe(0);
			expect(
				(
					await db.query(
						`select "dispatchToken" from history_archive_object_ready where "objectRemoteId"=$1`,
						[job.object.remoteId]
					)
				)[0].dispatchToken
			).toBe(job.token);
		}
	);
	it.each(['token', 'attempt', 'manual', 'publication'])(
		'final SQL fences changed %s identity',
		async (field) => {
			const job = await seed();
			const count = await db.transaction(async (manager: EntityManager) =>
				reconcileHistoryArchivePhaseSuppressedReservations(
					manager,
					new Date(),
					120,
					async () => {
						if (field === 'token')
							await manager.query(
								`update history_archive_object_ready set "dispatchToken"=$2 where "objectRemoteId"=$1`,
								[job.object.remoteId, randomUUID()]
							);
						if (field === 'attempt')
							await manager.query(
								`update history_archive_object_queue set attempts=attempts+1 where "remoteId"=$1`,
								[job.object.remoteId]
							);
						if (field === 'manual')
							await manager.query(
								`update history_archive_object_ready set "recheckRequestedAt"=now() where "objectRemoteId"=$1`,
								[job.object.remoteId]
							);
						if (field === 'publication')
							await manager.query(
								`update history_archive_object_ready set "publishedAt"="publishedAt"+interval '1 microsecond' where "objectRemoteId"=$1`,
								[job.object.remoteId]
							);
						return {
							executionIds: new Set(),
							confirmUnchanged: async () => true
						};
					}
				)
			);
			expect(count).toBe(0);
		}
	);
	it('caps the locked selection and leaves later suppressed jobs for a later pass', async () => {
		await seed();
		await seed();
		expect(await run(snapshot(), 1)).toBe(1);
		expect(await run(snapshot(), 1)).toBe(1);
	});
	it('bounds queue probes before filtering eligible rows out of the oldest window', async () => {
		const fresh = await seed('pending', 0);
		await seed();
		await db.query(
			`update history_archive_object_ready set "publishedAt"='2000-01-01Z' where "objectRemoteId"=$1`,
			[fresh.object.remoteId]
		);
		const read = jest.fn(snapshot());
		expect(await run(read, 1)).toBe(0);
		expect(read).not.toHaveBeenCalled();
		expect(await run(read, 2)).toBe(1);
	});
});
