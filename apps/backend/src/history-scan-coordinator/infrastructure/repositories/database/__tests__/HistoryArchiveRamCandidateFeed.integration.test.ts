import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import type { Logger } from 'logger';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import { HistoryArchiveObject } from '../../../../domain/history-archive-object/HistoryArchiveObject.js';
import { HistoryArchiveRamCandidateFeed } from '../HistoryArchiveRamCandidateFeed.js';
import { ArchiveBrokerReadyListener } from '../../../cli/archive-broker/ArchiveBrokerReadyListener.js';
import { HistoryArchiveRamFeedNotificationsMigration1791324000000 } from '../../../database/migrations/1791324000000-HistoryArchiveRamFeedNotificationsMigration.js';
import {
	historyArchiveBrokerCandidateProjectionSchemaSql,
	hydrateHistoryArchiveBrokerCandidatesSql
} from '../HistoryArchiveBrokerCandidateProjection.js';
import {
	historyArchiveRamNotificationChannel,
	historyArchiveRamFeedNotificationsSql,
	dropHistoryArchiveRamFeedNotificationsSql
} from '../HistoryArchiveRamFeedNotifications.js';
import {
	createKnownEvidenceDataSource,
	createEvidenceObject,
	resetKnownEvidence
} from './KnownArchiveEvidenceRepositoryFixture.js';

interface Listener {
	connect(): Promise<void>;
	end(): Promise<void>;
	query(sql: string): Promise<unknown>;
	on(
		event: 'notification',
		handler: (event: { payload?: string }) => void
	): void;
}
const { Client } = createRequire(import.meta.url)('pg') as {
	Client: new (options: { connectionString: string }) => Listener;
};
const delay = async (ms: number) =>
	await new Promise((resolve) => setTimeout(resolve, ms));
const root = 'https://ram-feed.example/history';
jest.setTimeout(60_000);

describe('RAM candidate metadata feed and commit-bound notification hints', () => {
	let pg: DisposablePostgres;
	let db: DataSource;
	let listener: Listener;
	let feed: HistoryArchiveRamCandidateFeed;
	let notifications: string[];
	beforeAll(async () => {
		pg = await startDisposablePostgres();
		db = await createKnownEvidenceDataSource(pg.url);
		await db.query(`create table history_archive_object_ready (
		 "objectRemoteId" uuid primary key,"archiveUrlIdentity" text not null,
		 priority smallint not null,"availableAt" timestamptz not null,"updatedAt" timestamptz not null,
		 "dispatchToken" uuid,"claimAttempt" integer,"publishedAt" timestamptz,"recheckRequestedAt" timestamptz)`);
		await db.query(historyArchiveBrokerCandidateProjectionSchemaSql);
		await db.query(historyArchiveRamFeedNotificationsSql);
		listener = new Client({ connectionString: pg.url });
		notifications = [];
		listener.on('notification', (event) => {
			if (event.payload) notifications.push(event.payload);
		});
		await listener.connect();
		await listener.query(`listen ${historyArchiveRamNotificationChannel}`);
		feed = new HistoryArchiveRamCandidateFeed(db);
	});
	beforeEach(async () => {
		await db.query(
			'truncate history_archive_object_ready,history_archive_broker_candidate'
		);
		await resetKnownEvidence(db);
		await delay(20);
		notifications = [];
	});
	afterAll(async () => {
		if (listener) await listener.end();
		if (db?.isInitialized) await db.destroy();
		if (pg) await pg.stop();
	});
	async function seed(count = 1) {
		const objects = Array.from({ length: count }, (_, index) => {
			const object = createEvidenceObject(
				root,
				`ledger:${index}`,
				'ledger',
				'pending'
			);
			object.checkpointLedger = 63 + 64 * index;
			object.executionDisposition = 'executable';
			object.dependencyReady = true;
			return object;
		});
		await db.getRepository(HistoryArchiveObject).save(objects);
		await db.query(
			`insert into history_archive_object_ready
		 ("objectRemoteId","archiveUrlIdentity",priority,"availableAt","updatedAt")
		 select id,$2,2,'2000-01-01 00:00:00.000001Z','2001-01-01 00:00:00.000123Z' from unnest($1::uuid[]) id`,
			[objects.map((object) => object.remoteId), root]
		);
		return objects;
	}
	async function received(count = 1) {
		for (
			let attempt = 0;
			attempt < 100 && notifications.length < count;
			attempt++
		)
			await delay(10);
		expect(notifications.length).toBeGreaterThanOrEqual(count);
		return notifications.map(
			(payload) =>
				JSON.parse(payload) as {
					ids?: string[];
					context?: boolean;
					reset?: boolean;
				}
		);
	}
	it('reads exact missing-projection PK metadata without writing and preserves microseconds', async () => {
		const [object] = await seed();
		const page = await feed.snapshotPage(null);
		expect(page.rows).toHaveLength(1);
		expect(page.rows[0]).toMatchObject({
			remoteId: object!.remoteId,
			attempts: 0,
			availableAtUs: '946684800000001',
			updatedAtUs: '978307200000123'
		});
		expect(page.rows[0]).not.toHaveProperty('verificationFacts');
		expect(
			await db.query(
				'select count(*)::integer as count from history_archive_broker_candidate'
			)
		).toEqual([{ count: 0 }]);
	});
	it('pages past nonfresh and missing metadata without sticking, retaining future-due candidates', async () => {
		const objects = await seed(3);
		await db.query(
			`update history_archive_object_queue set attempts=1 where "remoteId"=$1`,
			[objects[0]!.remoteId]
		);
		await db.query(
			`update history_archive_object_ready set "availableAt"='2099-01-01Z' where "objectRemoteId"=$1`,
			[objects[1]!.remoteId]
		);
		await db.query(
			`insert into history_archive_object_ready ("objectRemoteId","archiveUrlIdentity",priority,"availableAt","updatedAt") values ($1,$2,2,now(),now())`,
			[randomUUID(), root]
		);
		const ids: string[] = [];
		let cursor: string | null = null;
		for (let pageNumber = 0; pageNumber < 5; pageNumber++) {
			const page = await feed.snapshotPage(cursor, 1);
			ids.push(...page.rows.map((row) => row.remoteId));
			if (!page.hasMore) break;
			expect(page.nextCursor).not.toBe(cursor);
			cursor = page.nextCursor;
		}
		expect(ids.sort()).toEqual(
			objects
				.slice(1)
				.map((object) => object.remoteId)
				.sort()
		);
	});
	it('refresh missing, removed and no-longer-fresh IDs as removals and enforces bounded input', async () => {
		const objects = await seed(2);
		await db.query(hydrateHistoryArchiveBrokerCandidatesSql, [null, 512]);
		await db.query(
			`update history_archive_object_queue set attempts=1 where "remoteId"=$1`,
			[objects[0]!.remoteId]
		);
		await db.query(
			`delete from history_archive_object_ready where "objectRemoteId"=$1`,
			[objects[1]!.remoteId]
		);
		expect(
			await feed.refreshIds(objects.map((object) => object.remoteId))
		).toEqual([]);
		await expect(
			feed.refreshIds(Array.from({ length: 129 }, randomUUID))
		).rejects.toThrow('128');
		await expect(feed.snapshotPage(null, 513)).rejects.toThrow('512');
		await expect(feed.refreshIds(['invalid'])).rejects.toThrow('identity');
	});
	it('emits bounded exact IDs for a statement only after commit, with no rollback notification', async () => {
		const objects = await seed(257);
		const messages = await received(3);
		expect(messages).toHaveLength(3);
		expect(messages.flatMap((message) => message.ids ?? []).sort()).toEqual(
			objects.map((object) => object.remoteId).sort()
		);
		for (const payload of notifications) {
			expect(Buffer.byteLength(payload)).toBeLessThan(8000);
			expect(
				(JSON.parse(payload) as { ids: string[] }).ids.length
			).toBeLessThanOrEqual(128);
		}
		notifications = [];
		const runner = db.createQueryRunner();
		await runner.connect();
		await runner.startTransaction();
		await runner.query('update history_archive_object_ready set priority=1');
		await delay(30);
		expect(notifications).toEqual([]);
		await runner.rollbackTransaction();
		await runner.release();
		await delay(30);
		expect(notifications).toEqual([]);
		await db.query('update history_archive_object_ready set priority=1');
		expect(
			(await received(3)).flatMap((message) => message.ids ?? [])
		).toHaveLength(257);
	});
	it('notifies candidate insert/change and ready deletion, not a no-op update', async () => {
		const [object] = await seed();
		await received();
		notifications = [];
		await db.query(hydrateHistoryArchiveBrokerCandidatesSql, [null, 512]);
		expect(await received()).toContainEqual({ ids: [object!.remoteId] });
		notifications = [];
		await db.query(
			`update history_archive_object_queue set "dependencyReady"=false where "remoteId"=$1`,
			[object!.remoteId]
		);
		expect(await received()).toContainEqual({ ids: [object!.remoteId] });
		notifications = [];
		await db.query('update history_archive_object_ready set priority=priority');
		await delay(30);
		expect(notifications).toEqual([]);
		await db.query(
			`delete from history_archive_object_ready where "objectRemoteId"=$1`,
			[object!.remoteId]
		);
		expect(await received()).toContainEqual({ ids: [object!.remoteId] });
	});
	it('invalidates changed controls/host/claim context and exposes active scoped counts', async () => {
		const objects = await seed(2);
		await db.query(
			`update history_archive_object_ready set "publishedAt"=now(),"dispatchToken"=$1,"claimAttempt"=1 where "objectRemoteId"=$2`,
			[randomUUID(), objects[0]!.remoteId]
		);
		await db.query(
			`update history_archive_object_queue set status='scanning',attempts=1 where "remoteId"=$1`,
			[objects[1]!.remoteId]
		);
		await db.query(
			`insert into history_archive_object_claim_slot ("objectRemoteId") values ($1)`,
			[objects[1]!.remoteId]
		);
		await db.query(
			`insert into history_archive_root_failure_control ("archiveUrlIdentity",scope,"failureKind","blockedUntil","adaptiveProbeState","nextProbeCheckpoint") values ($1,'ledger','missing','2099-01-01Z','{"unknown":[[63,127]]}',127)`,
			[root]
		);
		await db.query(
			`insert into history_archive_object_host_throttle ("hostIdentity","blockedUntil") values ($1,'2099-01-01Z')`,
			[objects[0]!.hostIdentity]
		);
		expect(await received()).toContainEqual({ context: true });
		const context = await feed.loadContext(null, [
			'https://z.example',
			root,
			'https://A.example'
		]);
		expect(context.controls[0]).toMatchObject({
			archiveUrlIdentity: root,
			scope: 'ledger',
			unknownCount: 1,
			nextProbeCheckpoint: 127
		});
		expect(context.activeHosts).toEqual([
			{ hostIdentity: objects[0]!.hostIdentity, activeCount: 1 }
		]);
		expect(context.activeScopes).toEqual([
			{
				archiveUrlIdentity: root,
				objectType: 'ledger',
				published: 1,
				scanning: 1
			}
		]);
		expect(context.hostThrottles).toHaveLength(1);
		expect(context.canonicalIncomplete).toBe(false);
		expect(context.rootSortRanks.map((row) => row.archiveUrlIdentity)).toEqual([
			'https://A.example',
			root,
			'https://z.example'
		]);
	});
	it('sends full-reset hint for truncate and down removes only its own triggers', async () => {
		await seed();
		await received();
		notifications = [];
		await db.query('truncate history_archive_object_ready');
		expect(await received()).toContainEqual({ reset: true });
		await db.query(dropHistoryArchiveRamFeedNotificationsSql);
		expect(
			await db.query(
				`select tgname from pg_trigger where tgname='history_archive_broker_candidate_refresh'`
			)
		).toHaveLength(1);
		await db.query(historyArchiveRamFeedNotificationsSql);
	});
	it('delivers real PostgreSQL hints through the production listener after LISTEN readiness', async () => {
		const changes: unknown[] = [];
		const availability = jest.fn();
		const productionListener = new ArchiveBrokerReadyListener(
			pg.url,
			jest.fn(),
			(payload) => changes.push(payload),
			availability,
			{ error: jest.fn() } as unknown as Logger
		);
		try {
			await productionListener.start();
			expect(availability).toHaveBeenLastCalledWith(true);
			const [object] = await seed();
			for (let attempt = 0; attempt < 100 && changes.length === 0; attempt++)
				await delay(10);
			expect(changes).toContainEqual({ ids: [object!.remoteId] });
		} finally {
			await productionListener.close();
		}
		expect(availability).toHaveBeenLastCalledWith(false);
	});
	it('installs idempotently inside one bounded transaction, never outside one', async () => {
		const runner = db.createQueryRunner();
		await runner.connect();
		const migration =
			new HistoryArchiveRamFeedNotificationsMigration1791324000000();
		try {
			await expect(migration.up(runner)).rejects.toThrow(
				'explicit transaction'
			);
			await runner.startTransaction();
			await migration.up(runner);
			await migration.up(runner);
			expect(
				await runner.query(
					`select current_setting('lock_timeout') as lock,current_setting('statement_timeout') as statement`
				)
			).toEqual([{ lock: '250ms', statement: '5s' }]);
			expect(
				await runner.query(
					`select count(*)::integer as count from pg_trigger where tgname like '%_ram_%' and not tgisinternal`
				)
			).toEqual([{ count: 20 }]);
			await runner.commitTransaction();
		} finally {
			if (runner.isTransactionActive) await runner.rollbackTransaction();
			await runner.release();
		}
	});
});
