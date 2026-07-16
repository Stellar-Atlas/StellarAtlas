import { DataSource } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import { HistoryArchiveObject } from '../../../../domain/history-archive-object/HistoryArchiveObject.js';
import { HistoryArchiveEvidenceRootSummaryMigration1784950000000 } from '../1784950000000-HistoryArchiveEvidenceRootSummaryMigration.js';
import { HistoryArchiveObjectTypeSummaryMigration1785080000000 } from '../1785080000000-HistoryArchiveObjectTypeSummaryMigration.js';
import { HistoryArchiveSummarySteadyStateMigration1785180000000 } from '../1785180000000-HistoryArchiveSummarySteadyStateMigration.js';

const rootA = 'https://history-a.example.com';
const rootB = 'https://history-b.example.com';
const rootC = 'https://history-c.example.com';

jest.setTimeout(180_000);

describe('HistoryArchiveSummarySteadyStateMigration1785180000000 integration', () => {
	let dataSource: DataSource;
	let postgres: DisposablePostgres;

	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		dataSource = new DataSource({
			dropSchema: true,
			entities: [HistoryArchiveObject],
			logging: false,
			synchronize: true,
			type: 'postgres',
			url: postgres.url
		});
		await dataSource.initialize();
	});

	afterAll(async () => {
		if (dataSource?.isInitialized) await dataSource.destroy();
		if (postgres !== undefined) await postgres.stop();
	});

	it('maintains exact summaries for status, type, root, insert, and delete changes', async () => {
		const pending = createObject(rootA, 'ledger:0000003f', 'ledger', 'pending');
		const bucket = createObject(
			rootA,
			`bucket:${'a'.repeat(64)}`,
			'bucket',
			'verified'
		);
		await dataSource
			.getRepository(HistoryArchiveObject)
			.save([pending, bucket]);
		await runMigration(
			dataSource,
			new HistoryArchiveEvidenceRootSummaryMigration1784950000000(),
			'up'
		);
		await runMigration(
			dataSource,
			new HistoryArchiveObjectTypeSummaryMigration1785080000000(),
			'up'
		);
		await runMigration(
			dataSource,
			new HistoryArchiveSummarySteadyStateMigration1785180000000(),
			'up'
		);

		await expectSummariesToMatchQueue(dataSource);
		await dataSource.query(
			`update history_archive_object_queue set status = 'scanning'
			 where "remoteId" = $1`,
			[pending.remoteId]
		);
		await expectSummariesToMatchQueue(dataSource);
		await dataSource.query(
			`update history_archive_object_queue
			 set status = 'failed', "failureChannel" = 'archive_evidence'
			 where "remoteId" = $1`,
			[pending.remoteId]
		);
		await expectSummariesToMatchQueue(dataSource);
		await dataSource.query(
			`update history_archive_object_queue
			 set "archiveUrlIdentity" = $1, "objectType" = 'transactions'
			 where "remoteId" = $2`,
			[rootB, pending.remoteId]
		);
		await expectSummariesToMatchQueue(dataSource);
		await dataSource.query(
			'delete from history_archive_object_queue where "remoteId" = $1',
			[bucket.remoteId]
		);
		await dataSource
			.getRepository(HistoryArchiveObject)
			.save(createObject(rootB, 'results:0000007f', 'results', 'pending'));
		await expectSummariesToMatchQueue(dataSource);
		await expectSteadyStateArtifacts(dataSource);
	});

	it('serializes concurrent status transitions without losing deltas', async () => {
		const objects = Array.from({ length: 24 }, (_, index) =>
			createObject(
				rootC,
				`ledger:${index.toString(16).padStart(8, '0')}`,
				'ledger',
				'pending'
			)
		);
		await dataSource.getRepository(HistoryArchiveObject).save(objects);
		await Promise.all(
			objects.map((object) =>
				dataSource.query(
					`update history_archive_object_queue set status = 'scanning'
					 where "remoteId" = $1`,
					[object.remoteId]
				)
			)
		);
		await expectSummariesToMatchQueue(dataSource);
		await Promise.all(
			objects.map((object) =>
				dataSource.query(
					`update history_archive_object_queue set status = 'verified'
					 where "remoteId" = $1`,
					[object.remoteId]
				)
			)
		);
		await expectSummariesToMatchQueue(dataSource);
	});
});

function createObject(
	archiveUrl: string,
	objectKey: string,
	objectType: HistoryArchiveObject['objectType'],
	status: HistoryArchiveObject['status']
): HistoryArchiveObject {
	return new HistoryArchiveObject({
		archiveUrl,
		archiveUrlIdentity: archiveUrl,
		bucketHash:
			objectType === 'bucket' ? objectKey.slice('bucket:'.length) : null,
		checkpointLedger: objectType === 'bucket' ? null : 63,
		objectKey,
		objectOrder: 10,
		objectType,
		objectUrl: `${archiveUrl}/${objectKey}.xdr.gz`,
		status
	});
}

async function expectSummariesToMatchQueue(
	dataSource: DataSource
): Promise<void> {
	const rootMismatches = await rows(
		dataSource,
		`with live as (
			select "archiveUrlIdentity", count(*) as total,
				count(*) filter (where status = 'pending') as pending,
				count(*) filter (where status = 'scanning') as active,
				count(*) filter (where status = 'verified') as verified,
				count(*) filter (where status = 'failed' and "failureChannel"
					= 'archive_evidence') as remote_failure,
				count(*) filter (where status = 'failed' and "failureChannel"
					= 'scanner_issue') as scanner_issue,
				count(*) filter (where "objectType" = 'bucket') as buckets,
				count(*) filter (where "objectType" = 'bucket' and status
					= 'verified') as verified_buckets
			from history_archive_object_queue group by "archiveUrlIdentity"
		)
		select 1 from live full join history_archive_evidence_root_summary summary
			using ("archiveUrlIdentity")
		where row(live.total, live.pending, live.active, live.verified,
			live.remote_failure, live.scanner_issue, live.buckets,
			live.verified_buckets) is distinct from row(
			summary."totalObjects", summary."pendingObjects",
			summary."activeObjects", summary."verifiedObjects",
			summary."remoteFailureObjects", summary."workerIssueObjects",
			summary."bucketObjects", summary."verifiedBucketObjects")`
	);
	const typeMismatches = await rows(
		dataSource,
		`with live as (
			select "archiveUrlIdentity", "objectType", count(*) as total,
				count(*) filter (where status = 'pending') as pending,
				count(*) filter (where status = 'scanning') as scanning,
				count(*) filter (where status = 'verified') as verified,
				count(*) filter (where status = 'failed' and "failureChannel"
					= 'archive_evidence') as remote_failure,
				count(*) filter (where status = 'failed' and "failureChannel"
					= 'scanner_issue') as scanner_issue
			from history_archive_object_queue
			group by "archiveUrlIdentity", "objectType"
		)
		select 1 from live full join history_archive_object_type_summary summary
			using ("archiveUrlIdentity", "objectType")
		where row(live.total, live.pending, live.scanning, live.verified,
			live.remote_failure, live.scanner_issue) is distinct from row(
			summary."totalObjects", summary."pendingObjects",
			summary."scanningObjects", summary."verifiedObjects",
			summary."remoteFailureObjects", summary."scannerIssueObjects")`
	);
	expect(rootMismatches).toEqual([]);
	expect(typeMismatches).toEqual([]);
}

async function expectSteadyStateArtifacts(
	dataSource: DataSource
): Promise<void> {
	const result = await rows(
		dataSource,
		`select index_state.indisready, index_state.indisvalid,
			pg_get_functiondef(
				'refresh_history_archive_evidence_root_summary()'::regprocedure
			) as root_function,
			pg_get_functiondef(
				'refresh_history_archive_object_type_summary()'::regprocedure
			) as type_function
		from pg_index index_state
		join pg_class index_class on index_class.oid = index_state.indexrelid
		where index_class.relname = 'idx_history_archive_object_scanning_claim'`
	);
	expect(result).toHaveLength(1);
	expect(result[0]?.indisready).toBe(true);
	expect(result[0]?.indisvalid).toBe(true);
	expect(String(result[0]?.root_function)).not.toContain(
		'history_archive_evidence_root_summary_progress'
	);
	expect(String(result[0]?.type_function)).not.toContain(
		'history_archive_object_type_summary_progress'
	);
}

async function runMigration(
	dataSource: DataSource,
	migration:
		| HistoryArchiveEvidenceRootSummaryMigration1784950000000
		| HistoryArchiveObjectTypeSummaryMigration1785080000000
		| HistoryArchiveSummarySteadyStateMigration1785180000000,
	direction: 'up'
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
	const result: Readonly<Record<string, unknown>>[] = [];
	for (const item of value) {
		if (!isRecord(item)) throw new Error('Expected a database row');
		result.push(item);
	}
	return result;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
