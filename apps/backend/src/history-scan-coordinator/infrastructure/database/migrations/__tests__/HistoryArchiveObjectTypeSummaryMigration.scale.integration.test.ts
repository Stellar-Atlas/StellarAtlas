import { performance } from 'node:perf_hooks';
import { DataSource } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import { HistoryArchiveObjectTypeSummaryMigration1785080000000 } from '../1785080000000-HistoryArchiveObjectTypeSummaryMigration.js';
import { archiveObjectTypeSummaryBatchSize } from '../../../repositories/database/HistoryArchiveObjectTypeSummarySql.js';

const describeScale =
	process.env.RUN_ARCHIVE_TYPE_SUMMARY_SCALE_TESTS === '1'
		? describe
		: describe.skip;
const queueRows = 1_000_000;
const rootCount = 256;

// Bulk-mounted initdb and fixture loading are intentionally outside the
// migration timing assertion and can be slow under concurrent production I/O.
const scaleSetupTimeoutMs = 1_800_000;
jest.setTimeout(scaleSetupTimeoutMs);

describeScale('history archive object type summary migration scale', () => {
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
		await createQueue(dataSource);
		await seedQueue(dataSource);
	}, scaleSetupTimeoutMs);

	afterAll(async () => {
		if (dataSource?.isInitialized) await dataSource.destroy();
		if (postgres !== undefined) await postgres.stop();
	});

	it('backfills bounded batches without rewriting the source relation', async () => {
		const migration = new HistoryArchiveObjectTypeSummaryMigration1785080000000(
			{
				afterBatchCommit: () => {
					batches++;
					peakHeapBytes = Math.max(
						peakHeapBytes,
						process.memoryUsage().heapUsed
					);
				}
			}
		);
		const queueBytesBefore = await relationBytes(
			dataSource,
			'history_archive_object_queue'
		);
		const heapBytesBefore = process.memoryUsage().heapUsed;
		let peakHeapBytes = heapBytesBefore;
		let batches = 0;
		const startedAt = performance.now();
		await runMigration(dataSource, migration, 'up');
		const migrationMs = performance.now() - startedAt;
		const queueBytesAfter = await relationBytes(
			dataSource,
			'history_archive_object_queue'
		);
		const summaryBytes = await totalRelationBytes(
			dataSource,
			'history_archive_object_type_summary'
		);
		const summaryRows = await integerScalar(
			dataSource,
			'select count(*)::integer as value from history_archive_object_type_summary'
		);
		const mismatches = await mismatchCount(dataSource);
		const progress = await queryRow(
			dataSource,
			`select "complete", "cutoffObjectId"::text as cutoff,
			 	"lastObjectId"::text as last,
			 	("completedAt" is not null) as "hasCompletedAt"
			 from history_archive_object_type_summary_progress where id = 1`
		);

		const updateStartedAt = performance.now();
		await dataSource.query(`
			update history_archive_object_queue
			set status = 'scanning'
			where id <= 1000 and status = 'pending'
		`);
		const thousandRowUpdateMs = performance.now() - updateStartedAt;
		const postUpdateMismatches = await mismatchCount(dataSource);

		console.info(
			'ARCHIVE_OBJECT_TYPE_SUMMARY_SCALE',
			JSON.stringify({
				batchSize: archiveObjectTypeSummaryBatchSize,
				batches,
				migrationMs: round(migrationMs),
				nodeHeapGrowthBytes: peakHeapBytes - heapBytesBefore,
				queueHeapGrowthBytes: queueBytesAfter - queueBytesBefore,
				queueRows,
				rootCount,
				summaryBytes,
				summaryRows,
				thousandRowUpdateMs: round(thousandRowUpdateMs)
			})
		);

		expect(progress).toEqual({
			complete: true,
			cutoff: queueRows.toString(),
			hasCompletedAt: true,
			last: queueRows.toString()
		});
		expect(batches).toBe(
			Math.ceil(queueRows / archiveObjectTypeSummaryBatchSize)
		);
		expect(summaryRows).toBe(rootCount * 7);
		expect(mismatches).toBe(0);
		expect(postUpdateMismatches).toBe(0);
		expect(queueBytesAfter - queueBytesBefore).toBeLessThan(1024 * 1024);
		expect(summaryBytes).toBeLessThan(8 * 1024 * 1024);
		expect(peakHeapBytes - heapBytesBefore).toBeLessThan(128 * 1024 * 1024);
		expect(migrationMs).toBeLessThan(120_000);
		expect(thousandRowUpdateMs).toBeLessThan(10_000);

		await runMigration(
			dataSource,
			new HistoryArchiveObjectTypeSummaryMigration1785080000000(),
			'down'
		);
		expect(await integerScalar(dataSource, queueCountSql)).toBe(queueRows);
	});
});

const queueCountSql =
	'select count(*)::integer as value from history_archive_object_queue';

async function createQueue(dataSource: DataSource): Promise<void> {
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
	const seedBatchSize = 50_000;
	for (let first = 1; first <= queueRows; first += seedBatchSize) {
		const last = Math.min(queueRows, first + seedBatchSize - 1);
		await dataSource.query(
			`insert into history_archive_object_queue (
			 	"archiveUrlIdentity", "objectType", status, "failureChannel"
			 )
			 select
			 	'https://archive-' || (item % $3::integer) || '.example/history',
			 	(array[
			 		'history-archive-state', 'checkpoint-state', 'ledger',
			 		'transactions', 'results', 'scp', 'bucket'
			 	])[1 + ((item - 1) % 7)],
			 	case
			 		when item % 20 < 10 then 'pending'
			 		when item % 20 < 14 then 'scanning'
			 		when item % 20 < 18 then 'verified'
			 		else 'failed'
			 	end,
			 	case
			 		when item % 20 = 18 then 'archive_evidence'
			 		when item % 20 = 19 then 'scanner_issue'
			 		else null
			 	end
			 from generate_series($1::integer, $2::integer) item`,
			[first, last, rootCount]
		);
	}
}

async function mismatchCount(dataSource: DataSource): Promise<number> {
	return integerScalar(
		dataSource,
		`
			with live as (
				select "archiveUrlIdentity", "objectType", count(*) as total,
					count(*) filter (where status = 'pending') as pending,
					count(*) filter (where status = 'scanning') as scanning,
					count(*) filter (where status = 'verified') as verified,
					count(*) filter (where status = 'failed'
						and "failureChannel" = 'archive_evidence') as remote,
					count(*) filter (where status = 'failed'
						and "failureChannel" = 'scanner_issue') as scanner
				from history_archive_object_queue
				group by "archiveUrlIdentity", "objectType"
			), mismatches as (
				select 1
				from live
				full join history_archive_object_type_summary summary
					using ("archiveUrlIdentity", "objectType")
				where row(live.total, live.pending, live.scanning, live.verified,
					live.remote, live.scanner) is distinct from row(
					summary."totalObjects", summary."pendingObjects",
					summary."scanningObjects", summary."verifiedObjects",
					summary."remoteFailureObjects", summary."scannerIssueObjects"
				)
			)
			select count(*)::integer as value from mismatches
		`
	);
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

async function relationBytes(
	dataSource: DataSource,
	relation: string
): Promise<number> {
	return bigintScalar(
		dataSource,
		'select pg_relation_size($1::regclass)::text as value',
		[relation]
	);
}

async function totalRelationBytes(
	dataSource: DataSource,
	relation: string
): Promise<number> {
	return bigintScalar(
		dataSource,
		'select pg_total_relation_size($1::regclass)::text as value',
		[relation]
	);
}

async function integerScalar(
	dataSource: DataSource,
	sql: string
): Promise<number> {
	const row = await queryRow(dataSource, sql);
	const value = row?.value;
	if (typeof value !== 'number') throw new Error('Expected integer value');
	return value;
}

async function bigintScalar(
	dataSource: DataSource,
	sql: string,
	parameters: readonly unknown[]
): Promise<number> {
	const row = await queryRow(dataSource, sql, parameters);
	const value = row?.value;
	if (typeof value !== 'string') throw new Error('Expected bigint value');
	return Number(value);
}

async function queryRow(
	dataSource: DataSource,
	sql: string,
	parameters: readonly unknown[] = []
): Promise<Readonly<Record<string, unknown>> | undefined> {
	const value: unknown = await dataSource.query(sql, [...parameters]);
	if (!Array.isArray(value)) throw new Error('Expected database rows');
	const first: unknown = value[0];
	if (first === undefined) return undefined;
	if (typeof first !== 'object' || first === null || Array.isArray(first)) {
		throw new Error('Expected a database row object');
	}
	return first as Readonly<Record<string, unknown>>;
}

function round(value: number): number {
	return Math.round(value * 100) / 100;
}
