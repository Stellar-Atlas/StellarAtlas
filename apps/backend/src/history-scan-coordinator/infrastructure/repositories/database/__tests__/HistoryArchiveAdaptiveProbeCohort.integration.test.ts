import type { DataSource } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import { HistoryArchiveObject } from '../../../../domain/history-archive-object/HistoryArchiveObject.js';
import { activateAdaptiveProbeCheckpointDependencies } from '../HistoryArchiveAdaptiveProbeCohort.js';
import { historyArchiveObjectOpenSequentialCohortSql } from '../HistoryArchiveSequentialChainSql.js';
import { cleanupReadyObjectsSql } from '../HistoryArchiveObjectReadyQueue.js';
import {
	createEvidenceObject,
	createKnownEvidenceDataSource,
	resetKnownEvidence
} from './KnownArchiveEvidenceRepositoryFixture.js';

jest.setTimeout(60_000);
const root = 'https://probe-cohort.example/history';
const point = 63999;
describe('exact adaptive checkpoint cohort', () => {
	let postgres: DisposablePostgres;
	let db: DataSource;
	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		db = await createKnownEvidenceDataSource(postgres.url);
		await db.query(`create table history_archive_object_ready (
			"objectRemoteId" uuid primary key,"archiveUrlIdentity" text,priority smallint,"availableAt" timestamptz,
			"dispatchToken" uuid,"claimAttempt" integer,"publishedAt" timestamptz,"recheckRequestedAt" timestamptz,
			"createdAt" timestamptz,"updatedAt" timestamptz);
			create table if not exists history_archive_checkpoint_content_observation ("archiveUrlIdentity" text,"checkpointLedger" integer,"contentDigest" text,"checkpointStateObjectRemoteId" uuid,"createdAt" timestamptz);
			create table if not exists history_archive_checkpoint_content ("contentDigest" text,"bucketSetDigest" text);
			create table if not exists history_archive_checkpoint_bucket_set_member ("bucketSetDigest" text,"bucketHash" text);
			create table if not exists history_archive_checkpoint_bucket_dependency ("archiveUrlIdentity" text,"checkpointLedger" integer,"bucketHash" text,"createdAt" timestamptz);
			create table if not exists history_archive_checkpoint_scan_cursor ("archiveUrlIdentity" text primary key,"nextHistoricalCheckpointLedger" integer,"latestCheckpointLedger" integer);`);
	});
	afterAll(async () => {
		if (db?.isInitialized) await db.destroy();
		if (postgres) await postgres.stop();
	});
	beforeEach(async () => {
		await db.query(
			'truncate history_archive_object_ready,history_archive_checkpoint_scan_cursor,history_archive_checkpoint_bucket_dependency'
		);
		await resetKnownEvidence(db);
		await db.query(
			'insert into history_archive_checkpoint_scan_cursor ("archiveUrlIdentity","nextHistoricalCheckpointLedger","latestCheckpointLedger") values($1,127,127999)',
			[root]
		);
	});
	async function control(scope = 'checkpoint-state') {
		await db.query(
			`insert into history_archive_root_failure_control ("archiveUrlIdentity",scope,"failureKind","adaptiveProbeState","nextProbeCheckpoint") values($1,$2,'missing','{}',$3)`,
			[root, scope, point]
		);
	}
	async function object(
		type: HistoryArchiveObject['objectType'],
		checkpoint = point,
		status: HistoryArchiveObject['status'] = 'pending',
		identity = root,
		key?: string
	) {
		const value = createEvidenceObject(
			identity,
			key ?? `${type}:${checkpoint.toString(16).padStart(8, '0')}`,
			type,
			status
		);
		Object.assign(value, {
			checkpointLedger: checkpoint,
			dependencyReady: true,
			executionDisposition: 'executable',
			executionReason: 'checkpoint-fanout'
		});
		return await db.getRepository(HistoryArchiveObject).save(value);
	}
	async function enqueue(value: HistoryArchiveObject) {
		await db.query(
			`insert into history_archive_object_ready ("objectRemoteId","archiveUrlIdentity",priority,"availableAt","createdAt","updatedAt") values($1,$2,2,now(),now(),now())`,
			[value.remoteId, value.archiveUrlIdentity]
		);
	}
	async function eligible(id: string) {
		return await db.query(
			`select object."remoteId" from history_archive_object_queue object where object."remoteId"=$1 and ${historyArchiveObjectOpenSequentialCohortSql('object')}`,
			[id]
		);
	}
	async function verifiedPoint() {
		const value = await object('checkpoint-state', point, 'verified');
		await db.query(
			'update history_archive_object_queue set "dependenciesMaterializedAt"=now() where "remoteId"=$1',
			[value.remoteId]
		);
		return value;
	}
	it('admits only the exact root, category and current pending control checkpoint', async () => {
		await control('ledger');
		const exact = await object('ledger');
		const adjacent = await object('ledger', point + 64);
		const otherType = await object('transactions');
		const otherRoot = await object(
			'ledger',
			point,
			'pending',
			'https://other.example'
		);
		expect(await eligible(exact.remoteId)).toHaveLength(1);
		for (const value of [adjacent, otherType, otherRoot])
			expect(await eligible(value.remoteId)).toEqual([]);
	});
	it('ready cleanup retains the exact unreserved probe but removes unrelated future work', async () => {
		await control();
		const exact = await object('checkpoint-state');
		const adjacent = await object('checkpoint-state', point + 64);
		await enqueue(exact);
		await enqueue(adjacent);
		await db.query(cleanupReadyObjectsSql);
		expect(
			await db.query(
				'select "objectRemoteId" from history_archive_object_ready'
			)
		).toEqual([{ objectRemoteId: exact.remoteId }]);
	});
	it('activates only materialized exact children, including an already-deduplicated bucket from an older checkpoint', async () => {
		await control();
		await verifiedPoint();
		const ledger = await object('ledger');
		const future = await object('ledger', point + 64);
		const failed = await object('results', point, 'failed');
		await db.query(
			'update history_archive_object_queue set "httpStatus"=404 where "remoteId"=$1',
			[failed.remoteId]
		);
		const unready = await object('transactions');
		await db.query(
			'update history_archive_object_queue set "dependencyReady"=false where "remoteId"=$1',
			[unready.remoteId]
		);
		const hash = 'a'.repeat(64);
		const bucket = await object(
			'bucket',
			127,
			'pending',
			root,
			`bucket:${hash}`
		);
		await db.query(
			'update history_archive_object_queue set "bucketHash"=$2 where "remoteId"=$1',
			[bucket.remoteId, hash]
		);
		await db.query(
			'insert into history_archive_checkpoint_bucket_dependency values($1,$2,$3,now())',
			[root, point, hash]
		);
		expect(
			await activateAdaptiveProbeCheckpointDependencies(db.manager, root, point)
		).toEqual({ activated: 2, ready: 2, materialized: false });
		expect(
			(
				await db.query(
					'select "objectRemoteId" from history_archive_object_ready order by "objectRemoteId"'
				)
			).map((row: { objectRemoteId: string }) => row.objectRemoteId)
		).toEqual([ledger.remoteId, bucket.remoteId].sort());
		for (const value of [future, failed, unready])
			expect(await eligible(value.remoteId)).toEqual([]);
		await db.query(
			'update history_archive_object_queue set "dependencyReady"=true where "remoteId"=$1',
			[unready.remoteId]
		);
		expect(
			await activateAdaptiveProbeCheckpointDependencies(db.manager, root, point)
		).toEqual({ activated: 1, ready: 1, materialized: true });
		expect(
			await db
				.getRepository(HistoryArchiveObject)
				.findOneByOrFail({ remoteId: failed.remoteId })
		).toMatchObject({ status: 'failed', httpStatus: 404 });
		await db.query(
			'update history_archive_root_failure_control set "nextProbeCheckpoint"=$2 where "archiveUrlIdentity"=$1',
			[root, point + 64]
		);
		await db.query(cleanupReadyObjectsSql);
		expect(await eligible(bucket.remoteId)).toHaveLength(1);
		expect(
			await db.query(
				'select "nextHistoricalCheckpointLedger" from history_archive_checkpoint_scan_cursor where "archiveUrlIdentity"=$1',
				[root]
			)
		).toEqual([{ nextHistoricalCheckpointLedger: 127 }]);
		expect(
			await db.query('select * from history_archive_checkpoint_scan_summary')
		).toEqual([]);
	});
	it('waits for verified normal materialization, not merely a pending or failed point', async () => {
		await control();
		const checkpoint = await object('checkpoint-state');
		await object('ledger');
		expect(
			await activateAdaptiveProbeCheckpointDependencies(db.manager, root, point)
		).toEqual({ activated: 0, ready: 0, materialized: false });
		await db.query(
			'update history_archive_object_queue set status=\'verified\' where "remoteId"=$1',
			[checkpoint.remoteId]
		);
		expect(
			(
				await activateAdaptiveProbeCheckpointDependencies(
					db.manager,
					root,
					point
				)
			).materialized
		).toBe(false);
		expect(
			await db.query('select * from history_archive_object_ready')
		).toEqual([]);
	});
	it('does not steal existing reservation fences or bypass pending terminal effects', async () => {
		await control();
		await verifiedPoint();
		const reserved = await object('ledger');
		await enqueue(reserved);
		await db.query(
			'update history_archive_object_ready set "dispatchToken"=gen_random_uuid(),"claimAttempt"=1 where "objectRemoteId"=$1',
			[reserved.remoteId]
		);
		const before = await db.query('select * from history_archive_object_ready');
		const pending = await object('transactions');
		await db.query(
			'update history_archive_object_queue set "transitionEffectsRequiredAt"=now(),"transitionEffectsCompletedAt"=null where "remoteId"=$1',
			[pending.remoteId]
		);
		expect(
			await activateAdaptiveProbeCheckpointDependencies(db.manager, root, point)
		).toEqual({ activated: 0, ready: 0, materialized: false });
		expect(
			await db.query('select * from history_archive_object_ready')
		).toEqual(before);
	});
	it('defers a locked ready row without reversing ready-before-object lock order', async () => {
		await control();
		await verifiedPoint();
		const ledger = await object('ledger');
		await enqueue(ledger);
		const holder = db.createQueryRunner();
		await holder.connect();
		await holder.startTransaction();
		try {
			await holder.query(
				'select 1 from history_archive_object_ready where "objectRemoteId"=$1 for update',
				[ledger.remoteId]
			);
			expect(
				await db.transaction((manager) =>
					activateAdaptiveProbeCheckpointDependencies(manager, root, point)
				)
			).toEqual({ activated: 0, ready: 0, materialized: false });
		} finally {
			await holder.rollbackTransaction();
			await holder.release();
		}
		expect(
			await db.transaction((manager) =>
				activateAdaptiveProbeCheckpointDependencies(manager, root, point)
			)
		).toEqual({ activated: 1, ready: 0, materialized: true });
	});
	it('advances bounded activation passes rather than repeatedly inspecting the first128 children', async () => {
		await control();
		await verifiedPoint();
		const buckets = Array.from({ length: 129 }, (_, index) => {
			const hash = (index + 1).toString(16).padStart(64, '0');
			const value = createEvidenceObject(
				root,
				`bucket:${hash}`,
				'bucket',
				'pending'
			);
			Object.assign(value, {
				bucketHash: hash,
				checkpointLedger: 127,
				dependencyReady: true,
				executionDisposition: 'deferred'
			});
			return value;
		});
		await db.getRepository(HistoryArchiveObject).save(buckets);
		await db.query(
			'insert into history_archive_checkpoint_bucket_dependency select $1,$2,hash,now() from unnest($3::text[])hash',
			[root, point, buckets.map((value) => value.bucketHash)]
		);
		expect(
			await db.transaction((manager) =>
				activateAdaptiveProbeCheckpointDependencies(manager, root, point)
			)
		).toEqual({ activated: 128, ready: 128, materialized: false });
		expect(
			await db.transaction((manager) =>
				activateAdaptiveProbeCheckpointDependencies(manager, root, point)
			)
		).toEqual({ activated: 1, ready: 1, materialized: true });
	});
});
