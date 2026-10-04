import type { DataSource } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import { HistoryArchiveObject } from '../../../../domain/history-archive-object/HistoryArchiveObject.js';
import { HistoryArchiveBrokerFrontierRepository } from '../HistoryArchiveBrokerFrontierRepository.js';
import {
	admitDailyTransientSourceRetries,
	admitTransientSourceRetriesSql,
	historyArchiveTransientSourceRetrySchemaSql
} from '../HistoryArchiveTransientSourceRetry.js';
import {
	createEvidenceObject,
	createKnownEvidenceDataSource,
	resetKnownEvidence
} from './KnownArchiveEvidenceRepositoryFixture.js';

jest.setTimeout(60_000);
const root = 'https://retry.example/history';
describe('bounded daily transient-source retry sweep', () => {
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
			"recheckRequestedAt" timestamptz,
			"createdAt" timestamptz not null default now(), "updatedAt" timestamptz not null
		)`);
		await db.query(historyArchiveTransientSourceRetrySchemaSql);
	});
	afterAll(async () => {
		if (db?.isInitialized) await db.destroy();
		if (postgres) await postgres.stop();
	});
	beforeEach(async () => {
		await db.query(
			'truncate history_archive_object_ready, history_archive_transient_source_retry_sweep'
		);
		await resetKnownEvidence(db);
		broker = new HistoryArchiveBrokerFrontierRepository(db);
	});
	async function seed(
		key: string,
		httpStatus: number | null = 500,
		errorType: string | null = 'ERR_BAD_RESPONSE',
		errorMessage: string | null = 'remote failure'
	) {
		const object = createEvidenceObject(
			root,
			`ledger:${key}`,
			'ledger',
			'failed'
		);
		object.httpStatus = httpStatus;
		object.errorType = errorType;
		object.errorMessage = errorMessage;
		object.failureChannel = 'archive_availability';
		object.dependencyReady = true;
		object.executionDisposition = 'deferred';
		object.attempts = 1;
		return await db.getRepository(HistoryArchiveObject).save(object);
	}
	async function sweep(limit = 128) {
		return await db.transaction((manager) =>
			admitDailyTransientSourceRetries(manager, limit)
		);
	}
	async function readyIds(): Promise<string[]> {
		const rows = (await db.query(
			'select "objectRemoteId" from history_archive_object_ready order by "objectRemoteId"'
		)) as { objectRemoteId: string }[];
		return rows.map((row) => row.objectRemoteId);
	}
	async function current(remoteId: string) {
		return await db
			.getRepository(HistoryArchiveObject)
			.findOneByOrFail({ remoteId });
	}

	it('never reactivates a superseded source object', async () => {
		const object = await seed('superseded');
		await db.query(
			`update history_archive_object_queue set "executionDisposition"='superseded' where "remoteId"=$1`,
			[object.remoteId]
		);
		expect(await sweep()).toBe(0);
		expect(await readyIds()).toEqual([]);
		expect((await current(object.remoteId)).executionDisposition).toBe(
			'superseded'
		);
	});

	it('immediately admits explicit500–599, timeout/cancelled/blank, never403/404/integrity or meaningful unknown errors', async () => {
		const admitted = await Promise.all([
			seed('500'),
			seed('599', 599),
			seed('timeout', null, 'HttpError', 'SB Connection time-out'),
			seed('cancelled', null, 'HttpError', 'cancelled'),
			seed('blank', null, 'HttpError', 'HttpError:')
		]);
		await Promise.all([
			seed('403', 403),
			seed('404', 404),
			seed('integrity', null, 'BUCKET_HASH_MISMATCH', null),
			seed('unknown', null, 'HttpError', 'a meaningful unexplained failure')
		]);
		expect(await sweep()).toBe(5);
		expect(await readyIds()).toEqual(admitted.map((o) => o.remoteId).sort());
		for (const object of admitted) {
			const persisted = await current(object.remoteId);
			expect(persisted.status).toBe('failed');
			expect(persisted.httpStatus).toBe(object.httpStatus);
			expect(persisted.errorMessage).toBe(object.errorMessage);
			expect(persisted.lastClaimedAt).toBeNull();
		}
	});

	it('permits previously attempted deferred files but waits for verification inputs and terminal transitions', async () => {
		const old = await seed('old');
		const missing = await seed('missing');
		const transitioning = await seed('transition');
		await db.query(
			'update history_archive_object_queue set "dependencyReady" = false where "remoteId" = $1',
			[missing.remoteId]
		);
		await db.query(
			'update history_archive_object_queue set "transitionEffectsRequiredAt" = now(), "transitionEffectsCompletedAt" = null where "remoteId" = $1',
			[transitioning.remoteId]
		);
		expect(await sweep()).toBe(1);
		expect(await readyIds()).toEqual([old.remoteId]);
	});

	it('keeps a durable cursor across fresh callers and does not skip due rows when a page exceeds admission capacity', async () => {
		const objects = await Promise.all(['a', 'b', 'c'].map((key) => seed(key)));
		expect(await sweep(1)).toBe(1);
		expect(await sweep(1)).toBe(1);
		expect(await sweep(1)).toBe(1);
		expect(await readyIds()).toEqual(objects.map((o) => o.remoteId).sort());
	});

	it('rolls back cursor and admission together when the process fails before commit', async () => {
		const object = await seed('crash');
		await expect(
			db.transaction(async (manager) => {
				await admitDailyTransientSourceRetries(manager, 10);
				throw new Error('simulated crash');
			})
		).rejects.toThrow('simulated crash');
		expect(await readyIds()).toEqual([]);
		expect(
			await db.query(
				'select * from history_archive_transient_source_retry_sweep'
			)
		).toEqual([]);
		expect(await sweep()).toBe(1);
		expect(await readyIds()).toEqual([object.remoteId]);
	});

	it('prioritizes source retries with a single slot and stamps no ordinary queue row', async () => {
		const retry = await seed('retry');
		const ordinary = createEvidenceObject(
			root,
			'ledger:ordinary',
			'ledger',
			'pending'
		);
		ordinary.dependencyReady = true;
		ordinary.executionDisposition = 'executable';
		await db.getRepository(HistoryArchiveObject).save(ordinary);
		await db.query(
			`insert into history_archive_object_ready ("objectRemoteId", "archiveUrlIdentity", priority, "availableAt", "updatedAt") values ($1,$2,0,now(),now())`,
			[ordinary.remoteId, root]
		);
		const before = await db.query(
			'select xmin::text from history_archive_object_queue where "remoteId"=$1',
			[ordinary.remoteId]
		);
		await sweep();
		const [job] = await broker.reserveJobs(
			1,
			8,
			2,
			'https://other.example/history'
		);
		expect(job?.job.remoteId).toBe(retry.remoteId);
		expect((await current(retry.remoteId)).lastClaimedAt).not.toBeNull();
		await broker.reserveJobs(1, 8);
		expect(
			await db.query(
				'select xmin::text from history_archive_object_queue where "remoteId"=$1',
				[ordinary.remoteId]
			)
		).toEqual(before);
	});

	it('preserves per-host inflight caps and explicit host throttles', async () => {
		await seed('a');
		await seed('b');
		await sweep();
		expect(await broker.reserveJobs(10, 1)).toHaveLength(1);
		expect(await broker.reserveJobs(10, 1)).toHaveLength(0);
		await db.query(
			'update history_archive_object_ready set "publishedAt"=null'
		);
		await db.query(
			`insert into history_archive_object_host_throttle values ('retry.example',now()+interval '1 hour')`
		);
		expect(await broker.reserveJobs(10, 8)).toHaveLength(0);
	});

	it('does not repeat a failed retry within a cycle and schedules the next cycle from its start', async () => {
		const object = await seed('daily');
		await sweep();
		await broker.reserveJobs(1, 8);
		await db.query('delete from history_archive_object_ready');
		await sweep();
		await sweep();
		expect(await sweep()).toBe(0);
		expect(await readyIds()).toEqual([]);
		const [state] = (await db.query(
			'select "nextSweepAt" > now()+interval \'23 hours\' as deferred from history_archive_transient_source_retry_sweep'
		)) as { deferred: boolean }[];
		expect(state?.deferred).toBe(true);
		await db.query(
			`update history_archive_object_queue set "lastClaimedAt"=now()-interval '25 hours' where "remoteId"=$1`,
			[object.remoteId]
		);
		await db.query(
			'update history_archive_transient_source_retry_sweep set "sweepStartedAt"=now(), "nextSweepAt"=now()'
		);
		expect(await sweep()).toBe(1);
	});

	it('retains earlier remote5xx and aborted observations after a worker issue, without changing findings', async () => {
		const objects = [
			await seed('retained500'),
			await seed('retained-abort', null, 'HttpError', 'aborted')
		];
		for (const object of objects) {
			await db.query(
				`update history_archive_object_queue set "failureChannel"='scanner_issue',
				"httpStatus"=null,"errorType"='LOCAL_DISK_FAILURE',"errorMessage"='disk unavailable' where "remoteId"=$1`,
				[object.remoteId]
			);
		}
		const before = await db.query(
			'select * from history_archive_retained_remote_finding order by "objectRemoteId"'
		);
		await sweep();
		await sweep();
		expect(await sweep()).toBe(2);
		expect(await readyIds()).toEqual(objects.map((o) => o.remoteId).sort());
		expect(
			await db.query(
				'select * from history_archive_retained_remote_finding order by "objectRemoteId"'
			)
		).toEqual(before);
	});

	it('never replaces existing reserved tokens, and rechecks cycle eligibility at admission', async () => {
		const object = await seed('conflict');
		await sweep();
		const [job] = await broker.reserveJobs(1, 8);
		const before = await db.query('select * from history_archive_object_ready');
		const [result] = (await db.query(admitTransientSourceRetriesSql, [
			JSON.stringify([object]),
			new Date(0)
		])) as { count: number }[];
		expect(result?.count).toBe(0);
		expect(
			await db.query('select * from history_archive_object_ready')
		).toEqual(before);
		expect(job?.executionId).toBeTruthy();
	});

	it.each([400, 401, 403, 404, 410, 422])(
		'does not resurrect retained timeouts after current HTTP %i',
		async (status) => {
			const object = await seed(
				'old-timeout',
				null,
				'HttpError',
				'SB Connection time-out'
			);
			await db.query(
				`update history_archive_object_queue set "failureChannel"='scanner_issue',
			"httpStatus"=$2,"errorType"='ERR_BAD_REQUEST',"errorMessage"='definitive HTTP response'
			where "remoteId"=$1`,
				[object.remoteId, status]
			);
			await sweep();
			await sweep();
			expect(await sweep()).toBe(0);
			expect(await readyIds()).toEqual([]);
			const [admission] = (await db.query(admitTransientSourceRetriesSql, [
				JSON.stringify([object]),
				new Date()
			])) as { count: number }[];
			expect(admission?.count).toBe(0);
			expect((await current(object.remoteId)).httpStatus).toBe(status);
		}
	);

	it('skips a completing ready row without waiting or resurrecting a newly verified failure', async () => {
		const object = await seed('completing');
		await sweep();
		await broker.reserveJobs(1, 8);
		const completion = db.createQueryRunner();
		await completion.connect();
		await completion.startTransaction();
		try {
			await completion.query(
				'select 1 from history_archive_object_ready where "objectRemoteId"=$1 for update',
				[object.remoteId]
			);
			const [result] = (await db.transaction(async (manager) => {
				await manager.query("set local statement_timeout='1s'");
				return await manager.query(admitTransientSourceRetriesSql, [
					JSON.stringify([object]),
					new Date(Date.now() + 60_000)
				]);
			})) as { count: number }[];
			expect(result?.count).toBe(0);
			await completion.query(
				`update history_archive_object_queue set status='verified',"httpStatus"=null where "remoteId"=$1`,
				[object.remoteId]
			);
			await completion.query(
				'delete from history_archive_object_ready where "objectRemoteId"=$1',
				[object.remoteId]
			);
			await completion.commitTransaction();
			expect(await readyIds()).toEqual([]);
		} finally {
			if (completion.isTransactionActive)
				await completion.rollbackTransaction();
			await completion.release();
		}
	});
});
