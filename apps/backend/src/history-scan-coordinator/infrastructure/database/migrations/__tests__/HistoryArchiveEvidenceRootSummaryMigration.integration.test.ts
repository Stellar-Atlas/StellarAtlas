import { DataSource, type QueryRunner } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import { HistoryArchiveCheckpointProof } from '../../../../domain/history-archive-checkpoint-proof/HistoryArchiveCheckpointProof.js';
import { HistoryArchiveObject } from '../../../../domain/history-archive-object/HistoryArchiveObject.js';
import { findKnownArchiveEvidenceRoots } from '../../../repositories/database/KnownArchiveEvidenceRootQuery.js';
import { HistoryArchiveEvidenceRootSummaryMigration1784950000000 } from '../1784950000000-HistoryArchiveEvidenceRootSummaryMigration.js';

const rootA = 'https://history-a.example.com';
const rootB = 'https://history-b.example.com';
const beforeFuture = new Date('2026-12-31T00:00:00.000Z');

jest.setTimeout(180_000);

describe('HistoryArchiveEvidenceRootSummaryMigration1784950000000', () => {
	let dataSource: DataSource;
	let postgres: DisposablePostgres;

	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		dataSource = new DataSource({
			dropSchema: true,
			entities: [HistoryArchiveCheckpointProof, HistoryArchiveObject],
			logging: false,
			synchronize: true,
			type: 'postgres',
			url: postgres.url
		});
		await dataSource.initialize();
		await dataSource.query(`
			create table history_archive_checkpoint_proof_rollup (
				"archiveUrlIdentity" text primary key,
				"totalCheckpointProofs" bigint not null default 0,
				"pendingCheckpointProofs" bigint not null default 0,
				"verifiedCheckpointProofs" bigint not null default 0,
				"mismatchCheckpointProofs" bigint not null default 0,
				"notEvaluableCheckpointProofs" bigint not null default 0
			)
		`);
		await dataSource.query(`
			create table history_archive_checkpoint_proof_rollup_progress (
				id smallint primary key,
				"cutoffProofId" bigint not null,
				"lastProofId" bigint not null,
				"complete" boolean not null
			)
		`);
		await dataSource.query(`
			insert into history_archive_checkpoint_proof_rollup_progress
			values (1, 0, 0, true)
		`);
	});

	afterAll(async () => {
		if (dataSource?.isInitialized) await dataSource.destroy();
		if (postgres !== undefined) await postgres.stop();
	});

	it('backfills, reconciles concurrent writes, and maintains exact snapshots', async () => {
		const pending = createObject(rootA, 'ledger:0000003f', 'ledger', 'pending');
		const bucket = createObject(
			rootA,
			`bucket:${'a'.repeat(64)}`,
			'bucket',
			'verified'
		);
		const workerIssue = createObject(
			rootB,
			'checkpoint-state:0000003f',
			'checkpoint-state',
			'failed'
		);
		workerIssue.failureChannel = 'scanner_issue';
		const deletedDuringBackfill = createObject(
			rootA,
			'results:0000003f',
			'results',
			'verified'
		);
		await dataSource
			.getRepository(HistoryArchiveObject)
			.save([pending, bucket, workerIssue, deletedDuringBackfill]);
		await dataSource.query(
			`update history_archive_object_queue
			 set "createdAt" = '2026-01-01T00:00:00.000Z'`
		);

		await expect(
			runMigration(
				dataSource,
				new HistoryArchiveEvidenceRootSummaryMigration1784950000000({
					beforeInitialBatchCommit: () => {
						throw new Error('injected batch failure');
					}
				}),
				'up'
			)
		).rejects.toThrow('injected batch failure');
		const rolledBackProgress = await rows(
			dataSource,
			`select "lastObjectId"::text as "lastObjectId"
			 from history_archive_evidence_root_summary_progress`
		);
		expect(rolledBackProgress[0]?.lastObjectId).toBe('0');
		expect(
			await rows(
				dataSource,
				'select 1 from history_archive_evidence_root_summary'
			)
		).toEqual([]);

		let active: HistoryArchiveObject | null = null;
		let concurrentWrites: Promise<void> | null = null;
		const migration =
			new HistoryArchiveEvidenceRootSummaryMigration1784950000000({
				beforeInitialBatchCommit: async () => {
					if (concurrentWrites !== null) return;
					active = createObject(
						rootA,
						'transactions:0000003f',
						'transactions',
						'scanning'
					);
					concurrentWrites = Promise.all([
						dataSource.query(
							`update history_archive_object_queue
							 set status = 'failed', "failureChannel" = 'archive_evidence'
							 where "remoteId" = $1`,
							[pending.remoteId]
						),
						dataSource.query(
							'delete from history_archive_object_queue where "remoteId" = $1',
							[deletedDuringBackfill.remoteId]
						),
						dataSource.getRepository(HistoryArchiveObject).save(active)
					]).then(() => undefined);
					await delay(50);
				},
				afterInitialBatch: async () => {
					await concurrentWrites;
				}
			});
		await runMigration(dataSource, migration, 'up');

		expect(concurrentWrites).not.toBeNull();
		await expectSummaryToMatchLiveRows(dataSource);
		await dataSource.query(
			`update history_archive_object_queue
			 set "createdAt" = '2027-01-01T00:00:00.000Z'
			 where "remoteId" = $1`,
			[bucket.remoteId]
		);

		const roots = await findKnownArchiveEvidenceRoots(
			dataSource.manager,
			[
				{ archiveUrl: rootA, archiveUrlIdentity: rootA },
				{ archiveUrl: rootB, archiveUrlIdentity: rootB }
			],
			beforeFuture
		);
		expect(
			roots.find((root) => root.archiveUrlIdentity === rootA)?.objects
		).toEqual({
			activeObjects: 1,
			bucketObjects: 0,
			pendingObjects: 0,
			remoteFailureObjects: 1,
			totalObjects: 2,
			verifiedBucketObjects: 0,
			verifiedObjects: 0,
			workerIssueObjects: 0
		});

		if (active === null) throw new Error('Expected a concurrent active object');
		await dataSource.query(
			`update history_archive_object_queue
			 set status = 'verified'
			 where "remoteId" = $1`,
			[active.remoteId]
		);
		await dataSource.query(
			'delete from history_archive_object_queue where "remoteId" = $1',
			[pending.remoteId]
		);
		await dataSource
			.getRepository(HistoryArchiveObject)
			.save(createObject(rootB, 'ledger:0000007f', 'ledger', 'pending'));
		await expectSummaryToMatchLiveRows(dataSource);
		await runMigration(
			dataSource,
			new HistoryArchiveEvidenceRootSummaryMigration1784950000000(),
			'up'
		);
		await expectSummaryToMatchLiveRows(dataSource);

		const truncateRunner = dataSource.createQueryRunner();
		await truncateRunner.connect();
		await truncateRunner.startTransaction();
		try {
			await truncateRunner.query('truncate history_archive_object_queue');
			await truncateRunner.rollbackTransaction();
		} finally {
			if (truncateRunner.isTransactionActive) {
				await truncateRunner.rollbackTransaction();
			}
			await truncateRunner.release();
		}
		await expectSummaryToMatchLiveRows(dataSource);

		const blocker = dataSource.createQueryRunner();
		await blocker.connect();
		await blocker.startTransaction();
		await blocker.query(
			'select 1 from history_archive_evidence_root_summary_progress'
		);
		try {
			await expect(
				runMigration(
					dataSource,
					new HistoryArchiveEvidenceRootSummaryMigration1784950000000(),
					'down'
				)
			).rejects.toThrow();
		} finally {
			await blocker.rollbackTransaction();
			await blocker.release();
		}
		await expectSummaryArtifacts(dataSource, true);
		await expectSummaryToMatchLiveRows(dataSource);

		await runMigration(
			dataSource,
			new HistoryArchiveEvidenceRootSummaryMigration1784950000000(),
			'down'
		);
		await expectSummaryArtifacts(dataSource, false);
		await runMigration(
			dataSource,
			new HistoryArchiveEvidenceRootSummaryMigration1784950000000(),
			'down'
		);
		await dataSource.query('truncate history_archive_object_queue');
	});

	it('orders a second batch behind concurrent truncate without deadlock', async () => {
		await dataSource.query(
			`
			insert into history_archive_object_queue (
				"remoteId", "archiveUrl", "archiveUrlIdentity", "hostIdentity",
				"objectType", "objectKey", "objectOrder", "objectUrl", status
			)
			select (
				'00000000-0000-4000-8000-' || lpad(value::text, 12, '0')
			)::uuid, $1, $1, 'history-a.example.com', 'ledger',
			'ledger:' || lpad(value::text, 12, '0'), value,
			$1 || '/ledger/' || value::text, 'pending'
			from generate_series(1, 100001) value
		`,
			[rootA]
		);

		let truncateCompletion: Promise<void> | null = null;
		const migration =
			new HistoryArchiveEvidenceRootSummaryMigration1784950000000({
				afterInitialBatch: async (progress) => {
					if (
						truncateCompletion !== null ||
						progress.lastObjectId >= progress.cutoffObjectId
					) {
						return;
					}
					const runner = dataSource.createQueryRunner();
					await runner.connect();
					await runner.startTransaction();
					await runner.query(
						'lock table history_archive_object_queue in access exclusive mode'
					);
					truncateCompletion = completeTruncateAfterDelay(runner);
				}
			});
		await runMigration(dataSource, migration, 'up');
		await truncateCompletion;
		expect(truncateCompletion).not.toBeNull();
		expect(
			await rows(
				dataSource,
				'select 1 from history_archive_evidence_root_summary'
			)
		).toEqual([]);
		const progress = await rows(
			dataSource,
			'select "complete" from history_archive_evidence_root_summary_progress'
		);
		expect(progress[0]?.complete).toBe(true);

		await dataSource
			.getRepository(HistoryArchiveObject)
			.save(createObject(rootB, 'ledger:after-truncate', 'ledger', 'pending'));
		await expectSummaryToMatchLiveRows(dataSource);

		await runMigration(
			dataSource,
			new HistoryArchiveEvidenceRootSummaryMigration1784950000000(),
			'down'
		);
		await dataSource.query('truncate history_archive_object_queue');
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

async function expectSummaryToMatchLiveRows(
	dataSource: DataSource
): Promise<void> {
	const mismatches = await rows(
		dataSource,
		`
			with live as (
				select "archiveUrlIdentity",
					count(*) as "totalObjects",
					count(*) filter (where status = 'pending') as "pendingObjects",
					count(*) filter (where status = 'scanning') as "activeObjects",
					count(*) filter (where status = 'verified') as "verifiedObjects",
					count(*) filter (where status = 'failed'
						and "failureChannel" = 'archive_evidence')
						as "remoteFailureObjects",
					count(*) filter (where status = 'failed'
						and "failureChannel" = 'scanner_issue')
						as "workerIssueObjects",
					count(*) filter (where "objectType" = 'bucket') as "bucketObjects",
					count(*) filter (where "objectType" = 'bucket'
						and status = 'verified') as "verifiedBucketObjects"
				from history_archive_object_queue
				group by "archiveUrlIdentity"
			)
			select coalesce(live."archiveUrlIdentity", summary."archiveUrlIdentity")
			from live
			full join history_archive_evidence_root_summary summary
				using ("archiveUrlIdentity")
			where row(
				live."totalObjects", live."pendingObjects", live."activeObjects",
				live."verifiedObjects", live."remoteFailureObjects",
				live."workerIssueObjects", live."bucketObjects",
				live."verifiedBucketObjects"
			) is distinct from row(
				summary."totalObjects", summary."pendingObjects",
				summary."activeObjects", summary."verifiedObjects",
				summary."remoteFailureObjects", summary."workerIssueObjects",
				summary."bucketObjects", summary."verifiedBucketObjects"
			)
		`
	);
	expect(mismatches).toEqual([]);
}

async function rows(
	dataSource: DataSource,
	sql: string
): Promise<readonly Readonly<Record<string, unknown>>[]> {
	const value: unknown = await dataSource.query(sql);
	if (!Array.isArray(value)) throw new Error('Expected database rows');
	const values: unknown[] = value;
	const result: Readonly<Record<string, unknown>>[] = [];
	for (const item of values) {
		if (!isRow(item)) {
			throw new Error('Expected a database row object');
		}
		result.push(item);
	}
	return result;
}

function isRow(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function runMigration(
	dataSource: DataSource,
	migration: HistoryArchiveEvidenceRootSummaryMigration1784950000000,
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

async function expectSummaryArtifacts(
	dataSource: DataSource,
	present: boolean
): Promise<void> {
	const result = await rows(
		dataSource,
		`
			select
				to_regclass('history_archive_evidence_root_summary')::text
					as summary,
				to_regclass('history_archive_evidence_root_summary_progress')::text
					as progress,
				to_regprocedure(
					'refresh_history_archive_evidence_root_summary()'
				)::text as refresh,
				to_regprocedure(
					'reset_history_archive_evidence_root_summary()'
				)::text as reset,
				(
					select count(*)::integer
					from pg_trigger
					where tgname in (
						'trg_history_archive_evidence_root_summary',
						'trg_history_archive_evidence_root_summary_truncate'
					)
						and not tgisinternal
				) as "triggerCount"
		`
	);
	const artifact = result[0];
	if (present) {
		expect(artifact).toEqual({
			progress: expect.any(String),
			refresh: expect.any(String),
			reset: expect.any(String),
			summary: expect.any(String),
			triggerCount: 2
		});
		return;
	}
	expect(artifact).toMatchObject({
		progress: null,
		refresh: null,
		reset: null,
		summary: null,
		triggerCount: 0
	});
}

async function completeTruncateAfterDelay(runner: QueryRunner): Promise<void> {
	await delay(50);
	try {
		await runner.query('truncate history_archive_object_queue');
		await runner.commitTransaction();
	} catch (error) {
		if (runner.isTransactionActive) await runner.rollbackTransaction();
		throw error;
	} finally {
		await runner.release();
	}
}

async function delay(milliseconds: number): Promise<void> {
	await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}
