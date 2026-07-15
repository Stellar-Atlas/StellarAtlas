import { DataSource, type MigrationInterface } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import { HistoryArchiveObjectTypeSummaryMigration1785080000000 } from '../1785080000000-HistoryArchiveObjectTypeSummaryMigration.js';
import { HistoryArchiveGlobalBucketHashIndexMigration1785090000000 } from '../1785090000000-HistoryArchiveGlobalBucketHashIndexMigration.js';
import { HistoryArchiveBucketReferenceSummaryMigration1785100000000 } from '../1785100000000-HistoryArchiveBucketReferenceSummaryMigration.js';
import { getExactUniqueBucketHashCount } from '../../../repositories/database/HistoryArchiveObjectBucketSummaryQuery.js';

const archiveA = 'https://archive-a.example';
const archiveB = 'https://archive-b.example';
const hashA = 'a'.repeat(64);
const hashB = 'b'.repeat(64);
const hashC = 'c'.repeat(64);
const hashD = 'd'.repeat(64);

jest.setTimeout(180_000);

describe('HistoryArchiveBucketReferenceSummaryMigration1785100000000', () => {
	let dataSource: DataSource;
	let postgres: DisposablePostgres;

	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		dataSource = new DataSource({ type: 'postgres', url: postgres.url });
		await dataSource.initialize();
	});

	beforeEach(async () => {
		await resetSchema(dataSource);
		await seedQueue(dataSource);
		await runMigration(
			dataSource,
			new HistoryArchiveObjectTypeSummaryMigration1785080000000()
		);
		await runMigration(
			dataSource,
			new HistoryArchiveGlobalBucketHashIndexMigration1785090000000()
		);
	});

	afterAll(async () => {
		if (dataSource?.isInitialized) await dataSource.destroy();
		if (postgres !== undefined) await postgres.stop();
	});

	it('resumes safely and tracks concurrent bucket identity changes', async () => {
		let injectFailure = true;
		await expect(
			runMigration(
				dataSource,
				new HistoryArchiveBucketReferenceSummaryMigration1785100000000({
					beforeBatchCommit: () => {
						if (!injectFailure) return;
						injectFailure = false;
						throw new Error('injected bucket batch failure');
					}
				})
			)
		).rejects.toThrow('injected bucket batch failure');
		expect(await progress(dataSource)).toMatchObject({
			complete: false,
			cutoffBucketHash: hashB,
			lastBucketHash: ''
		});
		expect(await globalSummary(dataSource)).toEqual([]);

		let concurrentWrites: Promise<void> | null = null;
		await runMigration(
			dataSource,
			new HistoryArchiveBucketReferenceSummaryMigration1785100000000({
				beforeBatchCommit: async () => {
					if (concurrentWrites !== null) return;
					concurrentWrites = Promise.all([
						dataSource.query(
							`update history_archive_object_queue
							 set "bucketHash" = $1 where id = 3`,
							[hashC]
						),
						dataSource.query(
							'delete from history_archive_object_queue where id = 1'
						),
						dataSource.query(
							`insert into history_archive_object_queue (
								"archiveUrlIdentity", "objectType", status,
								"failureChannel", "bucketHash"
							 ) values ($1, 'bucket', 'pending', null, $2)`,
							[archiveB, hashD]
						)
					]).then(() => undefined);
					await delay(50);
				},
				afterBatchCommit: async () => {
					await concurrentWrites;
				}
			})
		);

		expect(await progress(dataSource)).toMatchObject({
			complete: true,
			cutoffBucketHash: hashB,
			lastBucketHash: hashB
		});
		await expectSummariesToMatchQueue(dataSource);
		await expect(
			getExactUniqueBucketHashCount(dataSource.manager, null)
		).resolves.toBe(3);
		await expect(
			getExactUniqueBucketHashCount(dataSource.manager, archiveA)
		).resolves.toBe(1);
		await expect(
			getExactUniqueBucketHashCount(dataSource.manager, archiveB)
		).resolves.toBe(2);

		const transaction = dataSource.createQueryRunner();
		await transaction.connect();
		await transaction.startTransaction();
		try {
			await transaction.query(
				`update history_archive_object_queue
				 set "bucketHash" = $1 where id = 2`,
				[hashD]
			);
			await expect(
				getExactUniqueBucketHashCount(transaction.manager, null)
			).resolves.toBe(2);
			await transaction.rollbackTransaction();
		} finally {
			if (transaction.isTransactionActive) {
				await transaction.rollbackTransaction();
			}
			await transaction.release();
		}
		await expectSummariesToMatchQueue(dataSource);

		await dataSource.query('truncate history_archive_object_queue');
		await expect(
			getExactUniqueBucketHashCount(dataSource.manager, null)
		).resolves.toBe(0);
		await expectSummariesToMatchQueue(dataSource);

		await runMigration(
			dataSource,
			new HistoryArchiveBucketReferenceSummaryMigration1785100000000(),
			'down'
		);
		expect(await artifacts(dataSource)).toEqual({
			globalSummary: null,
			progress: null,
			refresh: null,
			reset: null,
			sourceSummary: null,
			triggerCount: 0
		});
	});
});

async function resetSchema(dataSource: DataSource): Promise<void> {
	await dataSource.query('drop table if exists history_archive_object_queue cascade');
	await dataSource.query('drop table if exists history_archive_object_type_summary_progress cascade');
	await dataSource.query('drop table if exists history_archive_object_type_summary cascade');
	await dataSource.query('drop table if exists history_archive_bucket_reference_summary_progress cascade');
	await dataSource.query('drop table if exists history_archive_bucket_reference_summary cascade');
	await dataSource.query('drop table if exists history_archive_bucket_identity_summary cascade');
	await dataSource.query('drop function if exists refresh_history_archive_object_type_summary() cascade');
	await dataSource.query('drop function if exists reset_history_archive_object_type_summary() cascade');
	await dataSource.query('drop function if exists refresh_history_archive_bucket_reference_summary() cascade');
	await dataSource.query('drop function if exists reset_history_archive_bucket_reference_summary() cascade');
	await dataSource.query(`
		create table history_archive_object_queue (
			id bigserial primary key,
			"archiveUrlIdentity" text not null,
			"objectType" text not null,
			status text not null,
			"failureChannel" text,
			"bucketHash" text
		)
	`);
}

async function seedQueue(dataSource: DataSource): Promise<void> {
	await dataSource.query(
		`insert into history_archive_object_queue (
			"archiveUrlIdentity", "objectType", status,
			"failureChannel", "bucketHash"
		 ) values
			($1, 'bucket', 'pending', null, $3),
			($2, 'bucket', 'verified', null, $3),
			($1, 'bucket', 'failed', 'archive_evidence', $4),
			($1, 'ledger', 'verified', null, null)`,
		[archiveA, archiveB, hashA, hashB]
	);
}

async function expectSummariesToMatchQueue(
	dataSource: DataSource
): Promise<void> {
	const mismatches = await rows(dataSource, `
		with live_source as (
			select "archiveUrlIdentity", "bucketHash", count(*) as reference_count
			from history_archive_object_queue
			where "objectType" = 'bucket' and "bucketHash" is not null
			group by "archiveUrlIdentity", "bucketHash"
		), source_mismatch as (
			select 1 from live_source full join
				history_archive_bucket_reference_summary summary
				using ("archiveUrlIdentity", "bucketHash")
			where live_source.reference_count is distinct from summary."referenceCount"
		), live_global as (
			select "bucketHash", count(*) as reference_count
			from history_archive_object_queue
			where "objectType" = 'bucket' and "bucketHash" is not null
			group by "bucketHash"
		), global_mismatch as (
			select 1 from live_global full join
				history_archive_bucket_identity_summary summary using ("bucketHash")
			where live_global.reference_count is distinct from summary."referenceCount"
		)
		select 1 from source_mismatch union all select 1 from global_mismatch
	`);
	expect(mismatches).toEqual([]);
}

async function progress(dataSource: DataSource) {
	return (
		await rows(
			dataSource,
			`select "complete", "cutoffBucketHash", "lastBucketHash"
			 from history_archive_bucket_reference_summary_progress where id = 1`
		)
	)[0];
}

async function globalSummary(dataSource: DataSource) {
	return rows(dataSource, 'select * from history_archive_bucket_identity_summary');
}

async function artifacts(dataSource: DataSource) {
	return (
		await rows(dataSource, `
			select
				to_regclass('history_archive_bucket_identity_summary')::text
					as "globalSummary",
				to_regclass('history_archive_bucket_reference_summary')::text
					as "sourceSummary",
				to_regclass('history_archive_bucket_reference_summary_progress')::text
					as progress,
				to_regprocedure('refresh_history_archive_bucket_reference_summary()')::text
					as refresh,
				to_regprocedure('reset_history_archive_bucket_reference_summary()')::text
					as reset,
				(select count(*)::integer from pg_trigger
				 where tgname like 'trg_history_archive_bucket_reference_summary%'
					and not tgisinternal) as "triggerCount"`)
	)[0];
}

async function runMigration(
	dataSource: DataSource,
	migration: MigrationInterface,
	direction: 'down' | 'up' = 'up'
): Promise<void> {
	const runner = dataSource.createQueryRunner();
	await runner.connect();
	try {
		await migration[direction](runner);
	} finally {
		await runner.release();
	}
}

async function rows(
	dataSource: DataSource,
	sql: string
): Promise<readonly Readonly<Record<string, unknown>>[]> {
	const value: unknown = await dataSource.query(sql);
	if (!Array.isArray(value)) throw new Error('Expected database rows');
	return value as readonly Readonly<Record<string, unknown>>[];
}

async function delay(milliseconds: number): Promise<void> {
	await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}
