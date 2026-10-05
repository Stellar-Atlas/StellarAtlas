import type { DataSource, EntityManager, QueryRunner } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import { HistoryArchiveObject } from '../../../../domain/history-archive-object/HistoryArchiveObject.js';
import {
	historyArchiveBrokerCandidateProjectionSchemaSql,
	hydrateHistoryArchiveBrokerCandidatesSql,
	cleanupHistoryArchiveBrokerCandidatesSql
} from '../HistoryArchiveBrokerCandidateProjection.js';
import { buildReserveBrokerJobsSql } from '../HistoryArchiveBrokerReservationSql.js';
import {
	createEvidenceObject,
	createKnownEvidenceDataSource,
	resetKnownEvidence
} from './KnownArchiveEvidenceRepositoryFixture.js';

jest.setTimeout(60_000);
describe('broker candidate projection lock ordering', () => {
	let postgres: DisposablePostgres;
	let db: DataSource;
	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		db = await createKnownEvidenceDataSource(postgres.url);
		await db.query(`create table history_archive_object_ready (
		 "objectRemoteId" uuid primary key,"archiveUrlIdentity" text not null,priority smallint not null,
		 "availableAt" timestamptz not null,"dispatchToken" uuid,"claimAttempt" integer,
		 "publishedAt" timestamptz,"recheckRequestedAt" timestamptz,"updatedAt" timestamptz not null)`);
		await db.query(historyArchiveBrokerCandidateProjectionSchemaSql);
	});
	afterAll(async () => {
		if (db?.isInitialized) await db.destroy();
		if (postgres) await postgres.stop();
	});
	beforeEach(async () => {
		await db.query(
			'truncate history_archive_object_ready,history_archive_broker_candidate'
		);
		await resetKnownEvidence(db);
	});
	async function object(root = 'https://a.example/history') {
		const row = createEvidenceObject(
			root,
			'ledger:0000003f',
			'ledger',
			'pending'
		);
		row.checkpointLedger = 63;
		row.executionDisposition = 'executable';
		row.dependencyReady = true;
		await db.getRepository(HistoryArchiveObject).save(row);
		return row;
	}
	async function ready(manager: EntityManager, row: HistoryArchiveObject) {
		await manager.query(
			`insert into history_archive_object_ready
		 ("objectRemoteId","archiveUrlIdentity",priority,"availableAt","updatedAt") values($1,$2,2,now(),now())
		 on conflict("objectRemoteId") do update set "availableAt"=excluded."availableAt"`,
			[row.remoteId, row.archiveUrlIdentity]
		);
	}
	async function runner() {
		const runner = db.createQueryRunner();
		await runner.connect();
		await runner.startTransaction();
		await runner.query("set local statement_timeout='5s'");
		return runner;
	}
	async function release(...runners: QueryRunner[]) {
		for (const runner of runners) {
			if (runner.isTransactionActive) await runner.rollbackTransaction();
			await runner.release();
		}
	}
	async function waitForLock(pid: number) {
		for (let attempt = 0; attempt < 100; attempt++) {
			const [row] = await db.query(
				'select wait_event_type from pg_stat_activity where pid=$1',
				[pid]
			);
			if (row?.wait_event_type === 'Lock') return;
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
		throw new Error('Expected controlled disposable test lock');
	}
	it('does not block a compound queue-update then ready-upsert writer during initial admission', async () => {
		const row = await object();
		const writer = await runner();
		try {
			await writer.query(
				'update history_archive_object_queue set "dependencyReady"=false where "remoteId"=$1',
				[row.remoteId]
			);
			await ready(db.manager, row); // No synchronous ready -> queue/projection locking.
			const [skipped] = await db.query(
				hydrateHistoryArchiveBrokerCandidatesSql,
				[null, 1]
			);
			expect(skipped.hydrated).toBe(0);
			expect(skipped.cursor).toBe(row.remoteId);
			expect(
				await db.query(buildReserveBrokerJobsSql(false), [1, 8, 2, null])
			).toHaveLength(0);
			await ready(writer.manager, row);
			await writer.commitTransaction();
			await db.query(hydrateHistoryArchiveBrokerCandidatesSql, [null, 1]);
			expect(
				await db.query(
					'select "dependencyReady" from history_archive_broker_candidate'
				)
			).toEqual([{ dependencyReady: false }]);
		} finally {
			await release(writer);
		}
	});
	it('fences hydration against a later queue update without overwriting newer metadata', async () => {
		const row = await object();
		await ready(db.manager, row);
		const hydrator = await runner();
		const writer = await runner();
		try {
			await hydrator.query(hydrateHistoryArchiveBrokerCandidatesSql, [null, 1]);
			const [{ pid }] = await writer.query('select pg_backend_pid() as pid');
			const update = writer.query(
				'update history_archive_object_queue set "dependencyReady"=false where "remoteId"=$1',
				[row.remoteId]
			);
			await waitForLock(pid);
			await hydrator.commitTransaction();
			await update;
			await ready(writer.manager, row);
			await writer.commitTransaction();
			expect(
				await db.query(
					'select "dependencyReady" from history_archive_broker_candidate'
				)
			).toEqual([{ dependencyReady: false }]);
		} finally {
			await release(hydrator, writer);
		}
	});
	it('does not invert compound queue -> projection -> ready against ready deletion or orphan cleanup', async () => {
		const row = await object();
		await ready(db.manager, row);
		await db.query(hydrateHistoryArchiveBrokerCandidatesSql, [null, 1]);
		const writer = await runner();
		try {
			await writer.query(
				'update history_archive_object_queue set "dependencyReady"=false where "remoteId"=$1',
				[row.remoteId]
			);
			await db.query(
				'delete from history_archive_object_ready where "objectRemoteId"=$1',
				[row.remoteId]
			);
			await db.query(cleanupHistoryArchiveBrokerCandidatesSql); // skips writer's projection lock
			await ready(writer.manager, row);
			await writer.commitTransaction();
			expect(
				await db.query(
					'select "dependencyReady" from history_archive_broker_candidate'
				)
			).toEqual([{ dependencyReady: false }]);
		} finally {
			await release(writer);
		}
	});
	it('advances past busy queue identities so a locked prefix cannot starve a healthy root', async () => {
		const rows = [
			await object(),
			await object('https://b.example/history')
		].sort((a, b) => a.remoteId.localeCompare(b.remoteId));
		for (const row of rows) await ready(db.manager, row);
		const writer = await runner();
		try {
			await writer.query(
				'select "remoteId" from history_archive_object_queue where "remoteId"=$1 for update',
				[rows[0]!.remoteId]
			);
			const [first] = await db.query(hydrateHistoryArchiveBrokerCandidatesSql, [
				null,
				1
			]);
			expect(first.hydrated).toBe(0);
			const [second] = await db.query(
				hydrateHistoryArchiveBrokerCandidatesSql,
				[first.cursor, 1]
			);
			expect(second.hydrated).toBe(1);
			expect(
				await db.query(
					'select "remoteId" from history_archive_broker_candidate'
				)
			).toEqual([{ remoteId: rows[1]!.remoteId }]);
			await writer.commitTransaction();
			await db.query(hydrateHistoryArchiveBrokerCandidatesSql, [null, 1]);
			expect(
				await db.query(
					'select "remoteId" from history_archive_broker_candidate'
				)
			).toHaveLength(2);
		} finally {
			await release(writer);
		}
	});
	it('repairs metadata lost to an orphan-cleanup/concurrent ready-reinsert race', async () => {
		const row = await object();
		await ready(db.manager, row);
		await db.query(hydrateHistoryArchiveBrokerCandidatesSql, [null, 1]);
		await db.query('delete from history_archive_object_ready');
		await db.query(`create function pause_test_projection_delete() returns trigger language plpgsql as $$
		 begin perform pg_advisory_xact_lock(779125); return old; end $$;
		 create trigger pause_test_projection_delete before delete on history_archive_broker_candidate
		 for each row execute function pause_test_projection_delete()`);
		const barrier = await runner();
		const cleaner = await runner();
		try {
			await barrier.query('select pg_advisory_xact_lock(779125)');
			const [{ pid }] = await cleaner.query('select pg_backend_pid() as pid');
			const cleanup = cleaner.query(cleanupHistoryArchiveBrokerCandidatesSql);
			await waitForLock(pid);
			await ready(db.manager, row);
			await barrier.commitTransaction();
			await cleanup;
			await cleaner.commitTransaction();
			expect(
				await db.query(
					'select "remoteId" from history_archive_broker_candidate'
				)
			).toHaveLength(0);
			expect(
				await db.query(buildReserveBrokerJobsSql(false), [1, 8, 2, null])
			).toHaveLength(0);
			await db.query(hydrateHistoryArchiveBrokerCandidatesSql, [null, 1]);
			expect(
				await db.query(buildReserveBrokerJobsSql(false), [1, 8, 2, null])
			).toHaveLength(1);
		} finally {
			await release(barrier, cleaner);
			await db.query(
				'drop trigger pause_test_projection_delete on history_archive_broker_candidate; drop function pause_test_projection_delete()'
			);
		}
	});
});
