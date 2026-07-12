import { performance } from 'node:perf_hooks';
import { DataSource } from 'typeorm';
import { HistoryArchiveObjectClaimCursorMigration1784780000000 } from '../1784780000000-HistoryArchiveObjectClaimCursorMigration.js';
import { HistoryArchiveSchedulerOnlineIndexesMigration1784810000000 } from '../1784810000000-HistoryArchiveSchedulerOnlineIndexesMigration.js';
import { auditHistoryArchiveObjectRedundantIndexes } from '../../../repositories/database/HistoryArchiveObjectIndexAuditQuery.js';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';

const describeScale =
	process.env.RUN_ARCHIVE_SCALE_TESTS === '1' ? describe : describe.skip;
const queueRows = 1_000_000;

jest.setTimeout(480_000);

describeScale('history archive scheduler migration scale safety', () => {
	let dataSource: DataSource;
	let postgres: DisposablePostgres;

	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		dataSource = new DataSource({
			logging: false,
			type: 'postgres',
			url: postgres.url
		});
		await dataSource.initialize();
		await createLegacySchema(dataSource);
		await seedLegacyQueue(dataSource);
	});

	afterAll(async () => {
		if (dataSource?.isInitialized) await dataSource.destroy();
		if (postgres !== undefined) await postgres.stop();
	});

	it('fails fast on a conflicting lock, then migrates without a heap rewrite', async () => {
		const beforeBytes = await queueBytes(dataSource);
		const blocker = dataSource.createQueryRunner();
		const migrationRunner = dataSource.createQueryRunner();
		await blocker.startTransaction();
		await blocker.query(
			`update "history_archive_object_queue" set status = status where id = 1`
		);
		await migrationRunner.startTransaction();
		const blockedStartedAt = performance.now();
		await expect(
			new HistoryArchiveObjectClaimCursorMigration1784780000000().up(
				migrationRunner
			)
		).rejects.toThrow();
		const blockedMs = performance.now() - blockedStartedAt;
		await migrationRunner.rollbackTransaction();
		await blocker.rollbackTransaction();

		await migrationRunner.startTransaction();
		const migrationStartedAt = performance.now();
		await new HistoryArchiveObjectClaimCursorMigration1784780000000().up(
			migrationRunner
		);
		await migrationRunner.commitTransaction();
		const migrationMs = performance.now() - migrationStartedAt;
		const afterBytes = await queueBytes(dataSource);
		const [{ legacyDeferred }] = (await dataSource.query(`
			select count(*) filter (
				where status = 'pending' and "executionDisposition" is null
			)::integer as "legacyDeferred"
			from "history_archive_object_queue"
		`)) as readonly { readonly legacyDeferred: number }[];
		await blocker.release();
		await migrationRunner.release();

		console.info(
			'ARCHIVE_SCHEMA_MIGRATION_SCALE_METRICS',
			JSON.stringify({
				blockedMs: round(blockedMs),
				heapGrowthBytes: afterBytes - beforeBytes,
				legacyDeferred,
				migrationMs: round(migrationMs),
				queueRows
			})
		);
		expect(blockedMs).toBeLessThan(3_500);
		expect(afterBytes - beforeBytes).toBeLessThan(1024 * 1024);
		expect(legacyDeferred).toBe(queueRows);
	});

	it('builds tiny partial indexes while ordinary writes continue', async () => {
		const queryRunner = dataSource.createQueryRunner();
		const migrationStartedAt = performance.now();
		const migration =
			new HistoryArchiveSchedulerOnlineIndexesMigration1784810000000();
		const migrationPromise = migration.up(queryRunner);
		await sleep(100);
		const writeStartedAt = performance.now();
		await dataSource.query(
			`update "history_archive_object_queue" set "updatedAt" = now() where id = 2`
		);
		const concurrentWriteMs = performance.now() - writeStartedAt;
		await migrationPromise;
		const migrationMs = performance.now() - migrationStartedAt;
		const sizes = await indexSizes(dataSource);
		const duplicates = await auditHistoryArchiveObjectRedundantIndexes(
			dataSource.manager
		);
		await queryRunner.release();

		console.info(
			'ARCHIVE_ONLINE_INDEX_SCALE_METRICS',
			JSON.stringify({
				concurrentWriteMs: round(concurrentWriteMs),
				duplicates,
				indexBytes: sizes,
				migrationMs: round(migrationMs),
				productionAssumptions: {
					exactQueueRows: 31_009_646,
					freeDiskBytes: 18 * 1024 ** 3,
					plannerEstimatedRows: 2_000_000,
					queueRelationBytes: 33 * 1024 ** 3
				},
				queueRows
			})
		);
		expect(concurrentWriteMs).toBeLessThan(2_000);
		expect(sizes.executableClaim + sizes.transitionReconcile).toBeLessThan(
			1024 * 1024
		);
		expect(duplicates.length).toBeGreaterThan(0);
	});
});

async function createLegacySchema(dataSource: DataSource): Promise<void> {
	await dataSource.query(`create extension if not exists pgcrypto`);
	await dataSource.query(`
		create table "history_archive_object_queue" (
			id bigserial primary key,
			"remoteId" uuid not null default gen_random_uuid(),
			"archiveUrl" text not null,
			"archiveUrlIdentity" text not null,
			"hostIdentity" text not null,
			"objectType" text not null,
			"objectKey" text not null,
			"objectOrder" integer not null,
			"objectUrl" text not null,
			status text not null,
			"checkpointLedger" integer,
			"nextAttemptAt" timestamptz,
			"updatedAt" timestamptz not null default now()
		)
	`);
	await dataSource.query(`
		create unique index "queue_remote_constraint_index"
		on "history_archive_object_queue" ("remoteId")
	`);
	await dataSource.query(`
		create unique index "queue_remote_explicit_index"
		on "history_archive_object_queue" ("remoteId")
	`);
	await dataSource.query(`
		create unique index "queue_identity_index"
		on "history_archive_object_queue" (
			"archiveUrlIdentity", "objectType", "objectKey"
		)
	`);
	await dataSource.query(`
		create table "history_archive_object_host_throttle" (
			"hostIdentity" text primary key
		)
	`);
}

async function seedLegacyQueue(dataSource: DataSource): Promise<void> {
	const batchSize = 50_000;
	for (let first = 1; first <= queueRows; first += batchSize) {
		const last = Math.min(queueRows, first + batchSize - 1);
		await dataSource.query(
			`insert into "history_archive_object_queue" (
			"remoteId",
			"archiveUrl", "archiveUrlIdentity", "hostIdentity", "objectType",
			"objectKey", "objectOrder", "objectUrl", status,
			"checkpointLedger", "updatedAt"
		)
		select
			md5(item::text)::uuid,
			'https://archive-' || (item % 79) || '.example/history',
			'https://archive-' || (item % 79) || '.example/history',
			'archive-' || (item % 79) || '.example',
			'checkpoint-state', 'checkpoint-state:' || item, 10,
			'https://objects.example/' || item, 'pending',
			(item * 64 + 63)::integer, now()
		from generate_series($1::integer, $2::integer) item`,
			[first, last]
		);
	}
}

async function queueBytes(dataSource: DataSource): Promise<number> {
	const [{ bytes }] = (await dataSource.query(
		`select pg_relation_size('history_archive_object_queue')::bigint as bytes`
	)) as readonly { readonly bytes: number | string }[];
	return Number(bytes);
}

async function indexSizes(dataSource: DataSource) {
	const [sizes] = (await dataSource.query(`
		select
			pg_relation_size('idx_history_archive_object_executable_claim')::bigint
				as "executableClaim",
			pg_relation_size('idx_history_archive_object_transition_reconcile')::bigint
				as "transitionReconcile"
	`)) as readonly {
		readonly executableClaim: number | string;
		readonly transitionReconcile: number | string;
	}[];
	return {
		executableClaim: Number(sizes?.executableClaim ?? 0),
		transitionReconcile: Number(sizes?.transitionReconcile ?? 0)
	};
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function round(value: number): number {
	return Math.round(value * 100) / 100;
}
