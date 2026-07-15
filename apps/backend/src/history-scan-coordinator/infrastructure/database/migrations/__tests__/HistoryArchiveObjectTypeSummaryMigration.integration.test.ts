import { DataSource } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import { HistoryArchiveObjectTypeSummaryMigration1785080000000 } from '../1785080000000-HistoryArchiveObjectTypeSummaryMigration.js';

const rootA = 'https://archive-a.example/history';
const rootB = 'https://archive-b.example/history';

jest.setTimeout(180_000);

describe('HistoryArchiveObjectTypeSummaryMigration1785080000000 integration', () => {
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
	});

	beforeEach(async () => {
		await resetSchema(dataSource);
	});

	afterAll(async () => {
		if (dataSource?.isInitialized) await dataSource.destroy();
		if (postgres !== undefined) await postgres.stop();
	});

	it('resumes failed batches and reconciles concurrent and transactional writes', async () => {
		await seedQueue(dataSource);
		let injectFailure = true;
		await expect(
			runMigration(
				dataSource,
				new HistoryArchiveObjectTypeSummaryMigration1785080000000({
					beforeBatchCommit: () => {
						if (!injectFailure) return;
						injectFailure = false;
						throw new Error('injected batch failure');
					}
				}),
				'up'
			)
		).rejects.toThrow('injected batch failure');

		expect(await progress(dataSource)).toMatchObject({
			complete: false,
			completedAt: null,
			cutoffObjectId: '6',
			lastObjectId: '0'
		});
		expect(
			await queryRows(
				dataSource,
				'select 1 from history_archive_object_type_summary'
			)
		).toEqual([]);

		let concurrentWrites: Promise<void> | null = null;
		await runMigration(
			dataSource,
			new HistoryArchiveObjectTypeSummaryMigration1785080000000({
				beforeBatchCommit: async () => {
					if (concurrentWrites !== null) return;
					concurrentWrites = Promise.all([
						dataSource.query(
							`update history_archive_object_queue
							 set status = 'failed',
							 	"failureChannel" = 'archive_evidence'
							 where id = 1`
						),
						dataSource.query(
							`update history_archive_object_queue
							 set "archiveUrlIdentity" = $1,
							 	"objectType" = 'transactions', status = 'verified'
							 where id = 2`,
							[rootB]
						),
						dataSource.query(
							'delete from history_archive_object_queue where id = 3'
						),
						dataSource.query(
							`insert into history_archive_object_queue (
							 	"archiveUrlIdentity", "objectType", status
							 ) values ($1, 'bucket', 'scanning')`,
							[rootA]
						)
					]).then(() => undefined);
					await delay(50);
				},
				afterBatchCommit: async () => {
					await concurrentWrites;
				}
			}),
			'up'
		);

		expect(concurrentWrites).not.toBeNull();
		expect(await progress(dataSource)).toMatchObject({
			complete: true,
			completedAt: expect.any(Date),
			cutoffObjectId: '6',
			lastObjectId: '6'
		});
		await expectSummaryToMatchQueue(dataSource);
		expect(await summaryFor(dataSource, rootA, 'bucket')).toEqual({
			pendingObjects: 0,
			remoteFailureObjects: 0,
			scannerIssueObjects: 1,
			scanningObjects: 1,
			totalObjects: 2,
			verifiedObjects: 0
		});

		const transaction = dataSource.createQueryRunner();
		await transaction.connect();
		await transaction.startTransaction();
		try {
			await transaction.query(
				`update history_archive_object_queue
				 set status = 'verified', "failureChannel" = null
				 where id = 1`
			);
			const inside = await runnerRows(
				transaction,
				`select "verifiedObjects"::integer as verified,
				 	"remoteFailureObjects"::integer as remote
				 from history_archive_object_type_summary
				 where "archiveUrlIdentity" = $1 and "objectType" = 'ledger'`,
				[rootA]
			);
			expect(inside[0]).toEqual({ remote: 0, verified: 1 });
			await transaction.rollbackTransaction();
		} finally {
			if (transaction.isTransactionActive) {
				await transaction.rollbackTransaction();
			}
			await transaction.release();
		}
		expect(await summaryFor(dataSource, rootA, 'ledger')).toMatchObject({
			remoteFailureObjects: 1,
			verifiedObjects: 0
		});

		await dataSource.query(
			`update history_archive_object_queue set status = 'pending' where id = 5`
		);
		await dataSource.query(
			'delete from history_archive_object_queue where id = 6'
		);
		await dataSource.query(
			`insert into history_archive_object_queue (
			 	"archiveUrlIdentity", "objectType", status
			 ) values ($1, 'ledger', 'verified')`,
			[rootB]
		);
		await expectSummaryToMatchQueue(dataSource);
		await runMigration(
			dataSource,
			new HistoryArchiveObjectTypeSummaryMigration1785080000000(),
			'up'
		);
		await expectSummaryToMatchQueue(dataSource);

		const sourceCount = await queueCount(dataSource);
		await runMigration(
			dataSource,
			new HistoryArchiveObjectTypeSummaryMigration1785080000000(),
			'down'
		);
		expect(await queueCount(dataSource)).toBe(sourceCount);
		expect(await artifacts(dataSource)).toEqual({
			progress: null,
			refresh: null,
			reset: null,
			summary: null,
			triggerCount: 0
		});
	});
});

async function resetSchema(dataSource: DataSource): Promise<void> {
	await dataSource.query(
		'drop table if exists history_archive_object_queue cascade'
	);
	await dataSource.query(
		'drop table if exists history_archive_object_type_summary_progress'
	);
	await dataSource.query(
		'drop table if exists history_archive_object_type_summary'
	);
	await dataSource.query(
		'drop function if exists refresh_history_archive_object_type_summary()'
	);
	await dataSource.query(
		'drop function if exists reset_history_archive_object_type_summary()'
	);
	await dataSource.query(`
		create table history_archive_object_queue (
			id bigserial primary key,
			"archiveUrlIdentity" text not null,
			"objectType" text not null,
			status text not null,
			"failureChannel" text
		)
	`);
}

async function seedQueue(dataSource: DataSource): Promise<void> {
	await dataSource.query(
		`insert into history_archive_object_queue (
		 	"archiveUrlIdentity", "objectType", status, "failureChannel"
		 ) values
		 	($1, 'ledger', 'pending', null),
		 	($1, 'ledger', 'verified', null),
		 	($1, 'bucket', 'failed', 'archive_evidence'),
		 	($1, 'bucket', 'failed', 'scanner_issue'),
		 	($2, 'transactions', 'scanning', null),
		 	($2, 'transactions', 'failed', null)`,
		[rootA, rootB]
	);
}

async function expectSummaryToMatchQueue(
	dataSource: DataSource
): Promise<void> {
	const mismatches = await queryRows(
		dataSource,
		`
			with live as (
				select "archiveUrlIdentity", "objectType",
					count(*) as "totalObjects",
					count(*) filter (where status = 'pending') as "pendingObjects",
					count(*) filter (where status = 'scanning') as "scanningObjects",
					count(*) filter (where status = 'verified') as "verifiedObjects",
					count(*) filter (where status = 'failed'
						and "failureChannel" = 'archive_evidence')
						as "remoteFailureObjects",
					count(*) filter (where status = 'failed'
						and "failureChannel" = 'scanner_issue')
						as "scannerIssueObjects"
				from history_archive_object_queue
				group by "archiveUrlIdentity", "objectType"
			)
			select coalesce(live."archiveUrlIdentity", summary."archiveUrlIdentity")
			from live
			full join history_archive_object_type_summary summary
				using ("archiveUrlIdentity", "objectType")
			where row(
				live."totalObjects", live."pendingObjects", live."scanningObjects",
				live."verifiedObjects", live."remoteFailureObjects",
				live."scannerIssueObjects"
			) is distinct from row(
				summary."totalObjects", summary."pendingObjects",
				summary."scanningObjects", summary."verifiedObjects",
				summary."remoteFailureObjects", summary."scannerIssueObjects"
			)
		`
	);
	expect(mismatches).toEqual([]);
}

async function summaryFor(
	dataSource: DataSource,
	archiveUrlIdentity: string,
	objectType: string
): Promise<Readonly<Record<string, unknown>> | undefined> {
	const result = await queryRows(
		dataSource,
		`select "totalObjects"::integer as "totalObjects",
		 	"pendingObjects"::integer as "pendingObjects",
		 	"scanningObjects"::integer as "scanningObjects",
		 	"verifiedObjects"::integer as "verifiedObjects",
		 	"remoteFailureObjects"::integer as "remoteFailureObjects",
		 	"scannerIssueObjects"::integer as "scannerIssueObjects"
		 from history_archive_object_type_summary
		 where "archiveUrlIdentity" = $1 and "objectType" = $2`,
		[archiveUrlIdentity, objectType]
	);
	return result[0];
}

async function progress(dataSource: DataSource) {
	const result = await queryRows(
		dataSource,
		`select "complete", "completedAt", "cutoffObjectId"::text as "cutoffObjectId",
		 	"lastObjectId"::text as "lastObjectId"
		 from history_archive_object_type_summary_progress where id = 1`
	);
	return result[0];
}

async function artifacts(dataSource: DataSource) {
	const result = await queryRows(
		dataSource,
		`select
		 	to_regclass('history_archive_object_type_summary')::text as summary,
		 	to_regclass('history_archive_object_type_summary_progress')::text
		 		as progress,
		 	to_regprocedure('refresh_history_archive_object_type_summary()')::text
		 		as refresh,
		 	to_regprocedure('reset_history_archive_object_type_summary()')::text
		 		as reset,
		 	(select count(*)::integer from pg_trigger
		 	 where tgname like 'trg_history_archive_object_type_summary%'
		 	 	and not tgisinternal) as "triggerCount"`
	);
	return result[0];
}

async function queueCount(dataSource: DataSource): Promise<number> {
	const result = await queryRows(
		dataSource,
		'select count(*)::integer as count from history_archive_object_queue'
	);
	return requireNumber(result[0], 'count');
}

async function runMigration(
	dataSource: DataSource,
	migration: HistoryArchiveObjectTypeSummaryMigration1785080000000,
	direction: 'down' | 'up'
): Promise<void> {
	const runner = dataSource.createQueryRunner();
	await runner.connect();
	try {
		await migration[direction](runner);
	} finally {
		await runner.release();
	}
}

async function queryRows(
	dataSource: DataSource,
	sql: string,
	parameters: readonly unknown[] = []
): Promise<readonly Readonly<Record<string, unknown>>[]> {
	const value: unknown = await dataSource.query(sql, [...parameters]);
	return parseRows(value);
}

async function runnerRows(
	runner: import('typeorm').QueryRunner,
	sql: string,
	parameters: readonly unknown[] = []
): Promise<readonly Readonly<Record<string, unknown>>[]> {
	const value: unknown = await runner.query(sql, [...parameters]);
	return parseRows(value);
}

function parseRows(
	value: unknown
): readonly Readonly<Record<string, unknown>>[] {
	if (!Array.isArray(value)) throw new Error('Expected database rows');
	const values: unknown[] = value;
	const rows: Readonly<Record<string, unknown>>[] = [];
	for (const item of values) {
		if (!isRow(item)) throw new Error('Expected a database row object');
		rows.push(item);
	}
	return rows;
}

function isRow(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireNumber(
	row: Readonly<Record<string, unknown>> | undefined,
	field: string
): number {
	const value = row?.[field];
	if (typeof value !== 'number') throw new Error(`Expected numeric ${field}`);
	return value;
}

async function delay(milliseconds: number): Promise<void> {
	await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}
