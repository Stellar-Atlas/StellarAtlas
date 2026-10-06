import type { DataSource, EntityManager } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import { HistoryArchiveObject } from '../../../../domain/history-archive-object/HistoryArchiveObject.js';
import {
	loadHistoryArchiveAdaptiveProbeControls,
	maintainHistoryArchiveAdaptiveProbeControl,
	maintainHistoryArchiveAdaptiveProbes
} from '../HistoryArchiveAdaptiveProbeMaintenance.js';
import { HistoryArchiveBrokerFrontierRepository } from '../HistoryArchiveBrokerFrontierRepository.js';
import {
	createEvidenceObject,
	createKnownEvidenceDataSource,
	resetKnownEvidence
} from './KnownArchiveEvidenceRepositoryFixture.js';

jest.setTimeout(60_000);
const root = 'https://adaptive.example/history';
describe('durable adaptive probe maintenance', () => {
	let postgres: DisposablePostgres;
	let db: DataSource;
	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		db = await createKnownEvidenceDataSource(postgres.url);
		await db.query(`create table history_archive_object_ready (
 "objectRemoteId" uuid primary key,"archiveUrlIdentity" text not null,priority smallint not null,
 "availableAt" timestamptz not null,"dispatchToken" uuid,"claimAttempt" integer,"publishedAt" timestamptz,
 "recheckRequestedAt" timestamptz,"createdAt" timestamptz not null default now(),"updatedAt" timestamptz not null)`);
		await db.query(`create table if not exists history_archive_checkpoint_content_observation ("archiveUrlIdentity" text,"checkpointLedger" integer,"contentDigest" text,"checkpointStateObjectRemoteId" uuid,"createdAt" timestamptz);
 create table if not exists history_archive_checkpoint_content ("contentDigest" text,"bucketSetDigest" text);
 create table if not exists history_archive_checkpoint_bucket_set_member ("bucketSetDigest" text,"bucketHash" text);
 create table if not exists history_archive_checkpoint_bucket_dependency ("archiveUrlIdentity" text,"checkpointLedger" integer,"bucketHash" text,"createdAt" timestamptz);`);
	});
	afterAll(async () => {
		if (db?.isInitialized) await db.destroy();
		if (postgres) await postgres.stop();
	});
	beforeEach(async () => {
		await db.query('truncate history_archive_object_ready');
		await resetKnownEvidence(db);
	});
	async function seed(archive = root, scope = 'checkpoint-state') {
		await db
			.getRepository(HistoryArchiveObject)
			.save(
				createEvidenceObject(
					archive,
					'root',
					'history-archive-state',
					'verified'
				)
			);
		await db.query(
			`insert into history_archive_state_snapshot
 ("archiveUrl","archiveUrlIdentity","stateUrl",status,"observedAt",source,"currentLedger")
 values($1,$1,$1||'/.well-known/stellar-history.json','available',now(),'history-scanner',639)`,
			[archive]
		);
		await db.query(
			`insert into history_archive_root_failure_control
 ("archiveUrlIdentity",scope,"failureKind","consecutiveFailures","missingCheckpoints","lastFailureAt")
 values($1,$2,'missing',3,array[63,127,191],now())`,
			[archive, scope]
		);
		await db.query(
			`insert into history_archive_checkpoint_scan_cursor
 ("archiveUrlIdentity","nextHistoricalCheckpointLedger","latestCheckpointLedger") values($1,255,639)`,
			[archive]
		);
	}
	async function run(limit = 16) {
		return (await maintainHistoryArchiveAdaptiveProbes(db, limit)).admitted;
	}
	async function control(archive = root) {
		const [row] = await db.query(
			`select * from history_archive_root_failure_control where "archiveUrlIdentity"=$1`,
			[archive]
		);
		return row as {
			nextProbeCheckpoint: string | null;
			adaptiveProbeState: {
				unknown: { from: number; through: number }[];
				pending: { checkpoint: number; remoteId: string } | null;
			};
		};
	}
	async function assertNoCoverageOrCursorJump() {
		expect(
			await db.query(
				'select "nextHistoricalCheckpointLedger" as next from history_archive_checkpoint_scan_cursor'
			)
		).toEqual([{ next: 255 }]);
		expect(await db.query('select * from history_archive_listing_gap')).toEqual(
			[]
		);
		expect(
			await db.query('select * from history_archive_checkpoint_scan_bitmap')
		).toEqual([]);
		expect(
			await db.query('select * from history_archive_checkpoint_proof')
		).toEqual([]);
	}
	it('admits one bounded normal verification sample and survives dispatcher restart without duplicates', async () => {
		await seed();
		expect(await run()).toBe(1);
		expect(await run()).toBe(0);
		const row = await control();
		expect(Number(row.nextProbeCheckpoint)).toBe(639);
		expect(row.adaptiveProbeState.unknown).toEqual([
			{ from: 255, through: 639 }
		]);
		const object = await db
			.getRepository(HistoryArchiveObject)
			.findOneByOrFail({ remoteId: row.adaptiveProbeState.pending!.remoteId });
		expect(object.objectUrl).toBe(
			root + '/history/00/00/02/history-0000027f.json'
		);
		expect(object.attempts).toBe(0);
		expect(object.status).toBe('pending');
		await assertNoCoverageOrCursorJump();
	});
	it('consumes only a fetched missing point; no interval absence or retry of a known404', async () => {
		await seed();
		const missing = createEvidenceObject(
			root,
			'checkpoint-state:0000027f',
			'checkpoint-state',
			'failed'
		);
		missing.checkpointLedger = 639;
		missing.httpStatus = 404;
		missing.attempts = 1;
		await db.getRepository(HistoryArchiveObject).save(missing);
		expect(await run()).toBe(0); // Existing evidence is used, never reset/retried.
		expect(await run()).toBe(1);
		expect((await control()).adaptiveProbeState.unknown).toEqual([
			{ from: 255, through: 575 }
		]);
		expect(Number((await control()).nextProbeCheckpoint)).toBe(383);
		expect(
			(
				await db
					.getRepository(HistoryArchiveObject)
					.findOneByOrFail({ remoteId: missing.remoteId })
			).attempts
		).toBe(1);
		expect(
			await db.query(
				'select * from history_archive_object_ready where "objectRemoteId"=$1',
				[missing.remoteId]
			)
		).toEqual([]);
		await assertNoCoverageOrCursorJump();
	});
	it('does not consume transport/auth failures as absent points', async () => {
		await seed();
		await run();
		const before = await control();
		await db.query(
			`update history_archive_object_queue set status='failed',"httpStatus"=503 where "remoteId"=$1`,
			[before.adaptiveProbeState.pending!.remoteId]
		);
		expect(await run()).toBe(0);
		expect(await control()).toEqual(before);
	});
	it('normal successful future probe activates exact children and retains unknown history/frontier', async () => {
		await seed();
		await run();
		const pending = (await control()).adaptiveProbeState.pending!;
		const child = createEvidenceObject(
			root,
			'ledger:0000027f',
			'ledger',
			'pending'
		);
		Object.assign(child, {
			checkpointLedger: 639,
			dependencyReady: true,
			executionDisposition: 'deferred'
		});
		await db.getRepository(HistoryArchiveObject).save(child);
		await db.query(
			`update history_archive_object_queue set status='verified',"dependenciesMaterializedAt"=now()
 where "remoteId"=$1`,
			[pending.remoteId]
		);
		expect(await run()).toBe(1);
		expect((await control()).adaptiveProbeState.unknown).toEqual([
			{ from: 255, through: 575 }
		]);
		expect(Number((await control()).nextProbeCheckpoint)).toBe(383);
		expect(
			await db.query(
				'select "objectRemoteId" from history_archive_object_ready where "objectRemoteId"=$1',
				[child.remoteId]
			)
		).toHaveLength(1);
		expect(
			(
				await db
					.getRepository(HistoryArchiveObject)
					.findOneByOrFail({ remoteId: child.remoteId })
			).executionReason
		).toBe('adaptive-probe-dependency');
		await assertNoCoverageOrCursorJump();
	});
	it('keeps roots independent and respects the requested maintenance bound', async () => {
		await seed();
		await seed('https://other.example', 'ledger');
		expect(await run(1)).toBe(1);
		expect(await run(1)).toBe(1);
		const rows = await db.query(
			'select "archiveUrlIdentity",scope,"nextProbeCheckpoint" from history_archive_root_failure_control'
		);
		expect(rows).toHaveLength(2);
		for (const row of rows) expect(Number(row.nextProbeCheckpoint)).toBe(639);
	});
	it('rolls back queue/state together on a crash and concurrent callers converge', async () => {
		await seed();
		await expect(
			db.transaction(async (manager) => {
				const [row] = await loadHistoryArchiveAdaptiveProbeControls(manager, 1);
				await maintainHistoryArchiveAdaptiveProbeControl(manager, row);
				throw new Error('crash');
			})
		).rejects.toThrow('crash');
		expect((await control()).adaptiveProbeState).toBeNull();
		expect(
			await db.query('select * from history_archive_object_ready')
		).toEqual([]);
		const results = await Promise.all([run(), run()]);
		expect(results.reduce((sum, value) => sum + value, 0)).toBe(1);
		expect(
			await db.query('select * from history_archive_object_ready')
		).toHaveLength(1);
	});
	it.each([false, true])(
		'releases control A before waiting on ready B, preserving A on timeout (same root=%s)',
		async (sameRoot) => {
			await seed();
			const rootB = sameRoot ? root : 'https://other.example/history';
			if (sameRoot) {
				await db.query(
					`insert into history_archive_root_failure_control
 ("archiveUrlIdentity",scope,"failureKind","consecutiveFailures","missingCheckpoints","lastFailureAt")
 values($1,'ledger','missing',3,array[63,127,191],now())`,
					[rootB]
				);
			} else await seed(rootB, 'ledger');
			await db.query(`update history_archive_root_failure_control set "updatedAt"=
 now()-case when scope='checkpoint-state' then interval '2 minutes' else interval '1 minute' end`);
			const objectB = createEvidenceObject(
				rootB,
				'ledger:0000027f',
				'ledger',
				'pending'
			);
			objectB.checkpointLedger = 639;
			await db.getRepository(HistoryArchiveObject).save(objectB);
			await db.query(
				`insert into history_archive_object_ready
 ("objectRemoteId","archiveUrlIdentity",priority,"availableAt","updatedAt")
 values($1,$2,2,now(),now())`,
				[objectB.remoteId, rootB]
			);
			const broker = db.createQueryRunner();
			await broker.connect();
			await broker.startTransaction();
			let enterB!: () => void;
			const enteredB = new Promise<void>((resolve) => {
				enterB = resolve;
			});
			let transactionCount = 0;
			const transaction = async <T>(
				work: (manager: EntityManager) => Promise<T>
			) => {
				transactionCount++;
				if (transactionCount === 3) enterB();
				return db.transaction(work);
			};
			const deferred = jest.fn();
			const repository = new HistoryArchiveBrokerFrontierRepository(
				{ transaction } as unknown as DataSource,
				deferred
			);
			let maintenance: Promise<number> | undefined;
			try {
				// Reservation's relevant real lock sequence: ready B, then control A.
				await broker.query(
					"set local lock_timeout='100ms'; set local statement_timeout='2s'"
				);
				await broker.query(
					'select * from history_archive_object_ready where "objectRemoteId"=$1 for update',
					[objectB.remoteId]
				);
				maintenance = repository.maintainAdaptiveProbes(16);
				await Promise.race([
					enteredB,
					new Promise((_, reject) =>
						setTimeout(
							() => reject(new Error('No per-control transaction boundary')),
							2_000
						)
					)
				]);
				const [controlA] = await broker.query(
					`select "nextProbeCheckpoint" from
 history_archive_root_failure_control where "archiveUrlIdentity"=$1 and scope='checkpoint-state' for update`,
					[root]
				);
				expect(Number(controlA.nextProbeCheckpoint)).toBe(639);
				// B rolls back on its ready lock; committed A is still a positive result.
				await expect(maintenance).resolves.toBe(1);
				expect(deferred).toHaveBeenCalledWith('55P03');
				expect(transactionCount).toBe(3);
				await expect(repository.maintainAdaptiveProbes(16)).resolves.toBe(0);
				expect(transactionCount).toBe(3); // 60s failure backoff, no immediate retry.
				await broker.rollbackTransaction();
				const [controlB] = await db.query(
					`select "adaptiveProbeState" from
 history_archive_root_failure_control where "archiveUrlIdentity"=$1 and scope='ledger'`,
					[rootB]
				);
				expect(controlB.adaptiveProbeState).toBeNull();
				const clock = jest
					.spyOn(Date, 'now')
					.mockReturnValue(Date.now() + 60_001);
				try {
					await expect(repository.maintainAdaptiveProbes(16)).resolves.toBe(1);
				} finally {
					clock.mockRestore();
				}
				expect(
					await db.query('select * from history_archive_object_ready')
				).toHaveLength(2);
				for (const cursor of await db.query(
					'select "nextHistoricalCheckpointLedger" as next from history_archive_checkpoint_scan_cursor'
				))
					expect(cursor.next).toBe(255);
				expect(
					await db.query('select * from history_archive_checkpoint_proof')
				).toEqual([]);
			} finally {
				if (broker.isTransactionActive) await broker.rollbackTransaction();
				await broker.release();
				await maintenance;
			}
		}
	);
});
