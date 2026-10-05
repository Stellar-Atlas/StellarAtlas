import { randomUUID } from 'node:crypto';
import { DataSource, type EntityManager } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import { HistoryArchiveObject } from '../../../../domain/history-archive-object/HistoryArchiveObject.js';
import { HistoryArchiveCheckpointProof } from '../../../../domain/history-archive-checkpoint-proof/HistoryArchiveCheckpointProof.js';
import {
	adjacentCheckpointPrefetchSql,
	prefetchAdjacentCheckpointStates
} from '../HistoryArchiveAdjacentCheckpointPrefetch.js';
import { HistoryArchiveBrokerFrontierRepository } from '../HistoryArchiveBrokerFrontierRepository.js';
import { createCanonicalFrontierTestSchema } from './HistoryArchiveCanonicalFrontierTestSchema.js';
import {
	createRoot,
	createCheckpoint,
	createBucketMissingProof
} from './HistoryArchiveObjectExecutionTestFixtures.js';

jest.setTimeout(60_000);
describe('bounded adjacent checkpoint-state discovery', () => {
	let postgres: DisposablePostgres;
	let db: DataSource;
	const excludedBefore = process.env.HISTORY_ARCHIVE_EXCLUDED_HOSTS;
	const enabledBefore = process.env.HISTORY_ARCHIVE_ADJACENT_PREFETCH_ENABLED;
	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		db = new DataSource({
			type: 'postgres',
			url: postgres.url,
			synchronize: true,
			dropSchema: true,
			entities: [HistoryArchiveObject, HistoryArchiveCheckpointProof]
		});
		await db.initialize();
		await createCanonicalFrontierTestSchema(db);
		await db.query(
			'alter table history_archive_object_ready add column "recheckRequestedAt" timestamptz'
		);
	});
	afterAll(async () => {
		if (db?.isInitialized) await db.destroy();
		if (postgres) await postgres.stop();
	});
	beforeEach(async () => {
		process.env.HISTORY_ARCHIVE_ADJACENT_PREFETCH_ENABLED = 'true';
		delete process.env.HISTORY_ARCHIVE_EXCLUDED_HOSTS;
		await db.query(`truncate history_archive_object_ready,history_archive_root_failure_control,
			history_archive_object_host_throttle,history_archive_object_claim_slot,
			history_archive_listing_gap,history_archive_checkpoint_scan_cursor,history_archive_state_snapshot,
			history_archive_checkpoint_proof,history_archive_object_queue restart identity cascade`);
	});
	afterEach(() => {
		if (enabledBefore === undefined)
			delete process.env.HISTORY_ARCHIVE_ADJACENT_PREFETCH_ENABLED;
		else process.env.HISTORY_ARCHIVE_ADJACENT_PREFETCH_ENABLED = enabledBefore;
		if (excludedBefore === undefined)
			delete process.env.HISTORY_ARCHIVE_EXCLUDED_HOSTS;
		else process.env.HISTORY_ARCHIVE_EXCLUDED_HOSTS = excludedBefore;
	});
	async function seed(index = 0, head = 1023, open = 63) {
		const root = createRoot(index);
		root.hostIdentity = new URL(root.archiveUrl).hostname;
		await db.getRepository(HistoryArchiveObject).save(root);
		await db.query(
			`insert into history_archive_state_snapshot ("archiveUrlIdentity",status,"currentLedger") values($1,'available',$2)`,
			[root.archiveUrlIdentity, head]
		);
		await db.query(
			`insert into history_archive_checkpoint_scan_cursor ("archiveUrlIdentity","latestCheckpointLedger","nextHistoricalCheckpointLedger") values($1,$2,$3)`,
			[root.archiveUrlIdentity, head, open + 64]
		);
		return root;
	}
	async function run(
		depth = 4,
		budget = 128,
		identities: string[] | null = null,
		canonical: string | null = null
	) {
		return db.transaction(
			async (manager) =>
				(
					await manager.query(adjacentCheckpointPrefetchSql(), [
						identities,
						depth,
						budget,
						canonical
					])
				)[0] as { planned: number; ready: number }
		);
	}
	async function positions() {
		return db.query<
			{
				archiveUrlIdentity: string;
				checkpointLedger: number;
				priority: number;
			}[]
		>(`select object."archiveUrlIdentity",object."checkpointLedger",ready.priority
			from history_archive_object_ready ready join history_archive_object_queue object on object."remoteId"=ready."objectRemoteId"
			order by object."archiveUrlIdentity",object."checkpointLedger"`);
	}
	async function state(
		index: number,
		checkpoint: number,
		status: HistoryArchiveObject['status'] = 'pending',
		attempts = 0
	) {
		const object = createCheckpoint(index, checkpoint);
		object.status = status;
		object.attempts = attempts;
		object.dependencyReady = true;
		object.executionDisposition = 'executable';
		await db.getRepository(HistoryArchiveObject).save(object);
		return object;
	}
	it.each([undefined, 'false', '1', 'TRUE', ' true '])(
		'makes no database call unless explicitly enabled (%s)',
		async (enabled) => {
			if (enabled === undefined)
				delete process.env.HISTORY_ARCHIVE_ADJACENT_PREFETCH_ENABLED;
			else process.env.HISTORY_ARCHIVE_ADJACENT_PREFETCH_ENABLED = enabled;
			const transaction = jest.fn();
			expect(
				await prefetchAdjacentCheckpointStates(
					{ transaction } as unknown as DataSource,
					null
				)
			).toBe(0);
			expect(transaction).not.toHaveBeenCalled();
		}
	);
	it('commits lookahead before legacy maintenance times out, and repeated forced refill is a no-op', async () => {
		const root = await seed();
		let transactions = 0;
		const report = jest.fn();
		const repository = new HistoryArchiveBrokerFrontierRepository(
			{
				transaction: async <T>(
					work: (manager: EntityManager) => Promise<T>
				) => {
					if (++transactions % 2 === 0)
						throw Object.assign(new Error('legacy maintenance timed out'), {
							code: '57014'
						});
					return db.transaction(work);
				}
			} as DataSource,
			report
		);
		expect(await repository.ensurePrefetch(root.archiveUrlIdentity)).toBe(15);
		expect(await positions()).toHaveLength(15);
		expect(report).toHaveBeenCalledWith('57014');
		expect(await repository.ensurePrefetch(root.archiveUrlIdentity)).toBe(0);
		expect(await positions()).toHaveLength(15);
		expect(transactions).toBe(4);
		const [cursor] = await db.query(
			'select "nextHistoricalCheckpointLedger" from history_archive_checkpoint_scan_cursor'
		);
		expect(cursor.nextHistoricalCheckpointLedger).toBe(127);
	});
	it('rolls back every sibling admission when lookahead itself hits a conflicting unique row', async () => {
		await seed(0, 191);
		await seed(1, 191);
		const before = await db.query(
			'select * from history_archive_checkpoint_scan_cursor order by "archiveUrlIdentity"'
		);
		const runner = db.createQueryRunner();
		await runner.connect();
		await runner.startTransaction();
		try {
			await runner.manager
				.getRepository(HistoryArchiveObject)
				.save(createCheckpoint(1, 127));
			const report = jest.fn();
			expect(await prefetchAdjacentCheckpointStates(db, null, report)).toBe(0);
			expect(report).toHaveBeenCalledWith('55P03');
			expect(await positions()).toEqual([]);
			expect(
				await db
					.getRepository(HistoryArchiveObject)
					.findBy({ objectType: 'checkpoint-state' })
			).toEqual([]);
			expect(
				await db.query(
					'select * from history_archive_checkpoint_scan_cursor order by "archiveUrlIdentity"'
				)
			).toEqual(before);
		} finally {
			await runner.rollbackTransaction();
			await runner.release();
		}
	});
	it('caps a worker-pool-sized DML batch and remains finite across repeated maintenance', async () => {
		for (let index = 0; index < 2; index++) await seed(index, 8191);
		const started = performance.now();
		expect(await run(120, 120)).toEqual({ planned: 120, ready: 120 });
		console.info(
			JSON.stringify({
				adjacentPrefetchFixtureRows: 120,
				milliseconds: performance.now() - started
			})
		);
		expect(await positions()).toHaveLength(120);
		expect(await run(120, 120)).toEqual({ planned: 118, ready: 118 });
		expect(await run(120, 120)).toEqual({ planned: 0, ready: 0 });
		expect(await positions()).toHaveLength(238);
	});
	it('fills only the fixed adjacent cohort without advancing cursor, proofs, or scan coverage', async () => {
		const root = await seed();
		const before = await db.query(
			'select * from history_archive_checkpoint_scan_cursor'
		);
		expect(await run()).toEqual({ planned: 3, ready: 3 });
		expect((await positions()).map((x) => x.checkpointLedger)).toEqual([
			127, 191, 255
		]);
		expect(await run()).toEqual({ planned: 0, ready: 0 });
		expect(
			await db.query('select * from history_archive_checkpoint_scan_cursor')
		).toEqual(before);
		expect(await db.getRepository(HistoryArchiveCheckpointProof).count()).toBe(
			0
		);
		const rows = await db.getRepository(HistoryArchiveObject).findBy({
			archiveUrlIdentity: root.archiveUrlIdentity,
			objectType: 'checkpoint-state'
		});
		expect(
			rows.every(
				(x) =>
					x.status === 'pending' &&
					x.attempts === 0 &&
					x.verificationFacts === null
			)
		).toBe(true);
		expect(rows[0]?.objectUrl).toContain(
			'/history/00/00/00/history-0000007f.json'
		);
	});
	it('clips at advertised head and depth one, including partial final checkpoints', async () => {
		await seed(0, 250);
		expect(await run(1)).toEqual({ planned: 0, ready: 0 });
		expect(await run(120)).toEqual({ planned: 2, ready: 2 });
		expect((await positions()).map((x) => x.checkpointLedger)).toEqual([
			127, 191
		]);
	});
	it('interleaves roots before global write budget and does not let old rows consume repeat budgets', async () => {
		await seed(0);
		await seed(1);
		await seed(2);
		expect(await run(4, 3)).toEqual({ planned: 3, ready: 3 });
		expect((await positions()).map((x) => x.checkpointLedger)).toEqual([
			127, 127, 127
		]);
		expect(await run(4, 3)).toEqual({ planned: 3, ready: 3 });
		expect(
			(await positions()).filter((x) => x.checkpointLedger === 191)
		).toHaveLength(3);
		expect(await run(4, 3)).toEqual({ planned: 3, ready: 3 });
		expect(await run(4, 3)).toEqual({ planned: 0, ready: 0 });
	});
	it('does not hide a later root behind a full or blocked root prefix larger than the write budget', async () => {
		await seed(0);
		await seed(1);
		await seed(2);
		expect(await run(2, 1)).toEqual({ planned: 1, ready: 1 });
		expect(await run(2, 1)).toEqual({ planned: 1, ready: 1 });
		expect(await run(2, 1)).toEqual({ planned: 1, ready: 1 });
		expect(await positions()).toHaveLength(3);
	});
	it('does not revive failed, retried pending, scanning, verified, deferred, or future-scheduled objects', async () => {
		await seed();
		const cases: readonly [HistoryArchiveObject['status'], number][] = [
			['failed', 1],
			['pending', 1],
			['scanning', 1],
			['verified', 1],
			['pending', 0],
			['pending', 0]
		];
		for (let i = 0; i < cases.length; i++) {
			const item = await state(0, 127 + i * 64, ...cases[i]!);
			if (i === 0)
				await db.query(
					`update history_archive_object_queue set "httpStatus"=404,"errorMessage"='still missing' where "remoteId"=$1`,
					[item.remoteId]
				);
			if (i === 1)
				await db.query(
					`update history_archive_object_queue set "httpStatus"=503 where "remoteId"=$1`,
					[item.remoteId]
				);
			if (i === 4)
				await db.query(
					`update history_archive_object_queue set "executionDisposition"='deferred' where "remoteId"=$1`,
					[item.remoteId]
				);
			if (i === 5)
				await db.query(
					`update history_archive_object_queue set "nextAttemptAt"=now()+interval '1 day' where "remoteId"=$1`,
					[item.remoteId]
				);
		}
		const before = await db.query(
			'select * from history_archive_object_queue order by id'
		);
		expect(await run(7)).toEqual({ planned: 0, ready: 0 });
		expect(
			await db.query('select * from history_archive_object_queue order by id')
		).toEqual(before);
	});
	it('preserves explicit manual and active publication tokens byte-for-byte', async () => {
		await seed();
		const manual = await state(0, 127);
		const active = await state(0, 191);
		for (const [item, isManual] of [
			[manual, true],
			[active, false]
		] as const)
			await db.query(
				`insert into history_archive_object_ready
			("objectRemoteId","archiveUrlIdentity",priority,"dispatchToken","claimAttempt","publishedAt","recheckRequestedAt")
			values($1,$2,0,$3,1,case when $4 then null else now() end,case when $4 then now() else null end)`,
				[item.remoteId, item.archiveUrlIdentity, randomUUID(), isManual]
			);
		const before = await db.query(
			'select * from history_archive_object_ready order by "objectRemoteId"'
		);
		expect(await run(3)).toEqual({ planned: 0, ready: 0 });
		expect(
			await db.query(
				'select * from history_archive_object_ready order by "objectRemoteId"'
			)
		).toEqual(before);
	});
	it('admits an already-executable never-attempted row without rewriting its queue evidence', async () => {
		await seed();
		const item = await state(0, 127);
		const before = await db.query(
			'select * from history_archive_object_queue where "remoteId"=$1',
			[item.remoteId]
		);
		expect(await run(2)).toEqual({ planned: 0, ready: 1 });
		expect(
			await db.query(
				'select * from history_archive_object_queue where "remoteId"=$1',
				[item.remoteId]
			)
		).toEqual(before);
	});
	it('does not repopulate a recorded listing gap or already-proven checkpoint', async () => {
		const root = await seed();
		await db.query(
			`insert into history_archive_listing_gap ("archiveUrlIdentity","firstCheckpointLedger","lastCheckpointLedger","resumeCheckpointLedger","listingEvidence","observedAt") values($1,127,191,255,'{}',now())`,
			[root.archiveUrlIdentity]
		);
		const proof = createBucketMissingProof(root.archiveUrlIdentity, 255);
		proof.status = 'verified';
		await db.getRepository(HistoryArchiveCheckpointProof).save(proof);
		expect(await run()).toEqual({ planned: 0, ready: 0 });
	});
	it('honors root cooldown, host cooldown, exclusion, canonical-first and explicit target roots', async () => {
		const root = await seed(0);
		const other = await seed(1);
		await db.query(
			`insert into history_archive_root_failure_control ("archiveUrlIdentity",scope,"failureKind","blockedUntil") values($1,'checkpoint-state','transient',now()+interval '1 hour')`,
			[root.archiveUrlIdentity]
		);
		expect(await run(3, 128, [root.archiveUrlIdentity])).toEqual({
			planned: 0,
			ready: 0
		});
		expect(
			await run(3, 128, [other.archiveUrlIdentity], root.archiveUrlIdentity)
		).toEqual({ planned: 0, ready: 0 });
		await db.query(
			`insert into history_archive_object_host_throttle ("hostIdentity","archiveUrlIdentity","failureClass","evidenceClass","errorType","blockedUntil","lastFailureAt") values($1,$2,'rate-limit','archive-object','HTTP429',now()+interval '1 hour',now())`,
			[other.hostIdentity, other.archiveUrlIdentity]
		);
		expect(await run(3)).toEqual({ planned: 0, ready: 0 });
		await db.query(
			'truncate history_archive_object_host_throttle,history_archive_root_failure_control'
		);
		process.env.HISTORY_ARCHIVE_EXCLUDED_HOSTS = String(root.hostIdentity);
		expect(await run(3, 128, [root.archiveUrlIdentity])).toEqual({
			planned: 0,
			ready: 0
		});
	});
	it('honors exact adaptive probe point without opening its unknown interval', async () => {
		const root = await seed();
		await db.query(
			`insert into history_archive_root_failure_control ("archiveUrlIdentity",scope,"failureKind","adaptiveProbeState","nextProbeCheckpoint") values($1,'checkpoint-state','missing','{"unknown":[[63,1023]]}',191)`,
			[root.archiveUrlIdentity]
		);
		expect(await run()).toEqual({ planned: 1, ready: 1 });
		expect((await positions()).map((x) => x.checkpointLedger)).toEqual([191]);
	});
	it('does not overwrite a concurrently committed publication on an existing object', async () => {
		const root = await seed();
		const item = await state(0, 127);
		const token = randomUUID();
		const runner = db.createQueryRunner();
		await runner.connect();
		await runner.startTransaction();
		try {
			await runner.query(
				`insert into history_archive_object_ready ("objectRemoteId","archiveUrlIdentity",priority,"dispatchToken","claimAttempt","publishedAt") values($1,$2,2,$3,1,now())`,
				[item.remoteId, root.archiveUrlIdentity, token]
			);
			const concurrent = run(2);
			await new Promise((resolve) => setTimeout(resolve, 50));
			await runner.commitTransaction();
			expect(await concurrent).toEqual({ planned: 0, ready: 0 });
			expect(
				(
					await db.query(
						'select "dispatchToken" from history_archive_object_ready where "objectRemoteId"=$1',
						[item.remoteId]
					)
				)[0].dispatchToken
			).toBe(token);
		} finally {
			if (runner.isTransactionActive) await runner.rollbackTransaction();
			await runner.release();
		}
	});
});
