import type { DataSource } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import { HistoryArchiveObject } from '../../../../domain/history-archive-object/HistoryArchiveObject.js';
import {
	historyArchiveMaximumWatermark,
	calculateHistoryArchivePlanningPressure
} from '../../../../domain/history-archive-object/HistoryArchiveObjectPlanningPolicy.js';
import {
	buildHistoryArchiveReadyPressureSql,
	buildHistoryArchiveOutstandingReadyCountCtesSql
} from '../HistoryArchiveObjectReadyQueue.js';
import {
	createEvidenceObject,
	createKnownEvidenceDataSource,
	resetKnownEvidence
} from './KnownArchiveEvidenceRepositoryFixture.js';

jest.setTimeout(60_000);
describe('saturated archive pressure in disposable PostgreSQL', () => {
	let postgres: DisposablePostgres;
	let db: DataSource;
	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		db = await createKnownEvidenceDataSource(postgres.url);
		await db.query(`
			create table full_history_promotion_runtime (network_passphrase_hash bytea, checkpoint_ledger bigint, state text, last_outcome text, last_error_code text);
			create table full_history_watermark (network_passphrase_hash bytea, first_ledger bigint);
			create table full_history_historical_backfill_job (id uuid, network_passphrase_hash bytea, first_checkpoint_ledger bigint, last_checkpoint_ledger bigint, state text, created_at timestamptz);
			create table history_archive_object_claim_slot (slot integer, "objectRemoteId" uuid);
			create table history_archive_object_ready ("objectRemoteId" uuid primary key, "archiveUrlIdentity" text not null default '', priority smallint not null default 2, "publishedAt" timestamptz, "dispatchToken" uuid, "availableAt" timestamptz);
			create table if not exists history_archive_checkpoint_content_observation ("archiveUrlIdentity" text, "checkpointLedger" integer, "contentDigest" text, "checkpointStateObjectRemoteId" uuid, "createdAt" timestamptz);
			create table if not exists history_archive_checkpoint_content ("contentDigest" text, "bucketSetDigest" text);
			create table if not exists history_archive_checkpoint_bucket_set_member ("bucketSetDigest" text, "bucketHash" text);
			create table if not exists history_archive_checkpoint_bucket_dependency ("archiveUrlIdentity" text, "checkpointLedger" integer, "bucketHash" text, "createdAt" timestamptz);
		`);
	});
	afterAll(async () => {
		if (db?.isInitialized) await db.destroy();
		if (postgres) await postgres.stop();
	});
	beforeEach(async () => {
		await db.query(
			'truncate history_archive_object_ready, history_archive_object_claim_slot, full_history_promotion_runtime'
		);
		await resetKnownEvidence(db);
	});
	it.each([
		[historyArchiveMaximumWatermark - 1, false],
		[historyArchiveMaximumWatermark, true],
		[historyArchiveMaximumWatermark + 5, true]
	])(
		'reports saturation truthfully with %i ready objects',
		async (count, capped) => {
			const objects = Array.from({ length: count as number }, (_, i) => {
				const object = createEvidenceObject(
					`https://pressure-${i}.example`,
					'root',
					'history-archive-state',
					'pending'
				);
				object.checkpointLedger = null;
				return object;
			});
			await db.getRepository(HistoryArchiveObject).save(objects);
			await db.query(
				`insert into history_archive_object_ready ("objectRemoteId", "dispatchToken", "availableAt") select "remoteId", gen_random_uuid(), now() from history_archive_object_queue`
			);
			const [row] = (await db.query(
				buildHistoryArchiveReadyPressureSql(2)
			)) as {
				outstandingObjects: number;
				outstandingObjectsCapped: boolean;
				recentCompletions: null;
			}[];
			expect(row).toEqual({
				outstandingObjects: Math.min(
					count as number,
					historyArchiveMaximumWatermark
				),
				outstandingObjectsCapped: capped,
				pressureUnavailable: false,
				recentCompletions: null
			});
			const pressure = calculateHistoryArchivePlanningPressure(row!);
			expect(pressure.availableSlots).toBe(0);
			if (capped) expect(pressure.outstandingObjectsCapped).toBe(true);
		}
	);
	it('does not interpret an ineligible bounded window as free capacity', async () => {
		const objects = Array.from({ length: 130 }, (_, i) => {
			const object = createEvidenceObject(
				`https://deferred-${i}.example`,
				'root',
				'history-archive-state',
				'pending'
			);
			object.checkpointLedger = null;
			object.executionDisposition = 'deferred';
			return object;
		});
		await db.getRepository(HistoryArchiveObject).save(objects);
		await db.query(
			`insert into history_archive_object_ready ("objectRemoteId", "availableAt") select "remoteId", now() from history_archive_object_queue`
		);
		const [row] = await db.query(buildHistoryArchiveReadyPressureSql(2));
		expect(row).toEqual({
			outstandingObjects: 0,
			outstandingObjectsCapped: true,
			pressureUnavailable: true,
			recentCompletions: null
		});
		expect(calculateHistoryArchivePlanningPressure(row).availableSlots).toBe(0);
	});
	it('does not let ordinary held work hide priority-zero reservations', async () => {
		const held = Array.from({ length: 140 }, (_, i) =>
			createEvidenceObject(
				`https://held-${i}.example`,
				'root',
				'history-archive-state',
				'pending'
			)
		);
		await db.getRepository(HistoryArchiveObject).save(held);
		await db.query(
			`insert into history_archive_object_ready ("objectRemoteId","archiveUrlIdentity",priority,"availableAt") select "remoteId","archiveUrlIdentity",2,now() from history_archive_object_queue`
		);
		const reserved = await db
			.getRepository(HistoryArchiveObject)
			.save(
				createEvidenceObject(
					'https://reserved.example',
					'root',
					'history-archive-state',
					'pending'
				)
			);
		await db.query(
			`insert into history_archive_object_ready ("objectRemoteId","archiveUrlIdentity",priority,"availableAt","dispatchToken") values($1,$2,0,now(),gen_random_uuid())`,
			[reserved.remoteId, reserved.archiveUrlIdentity]
		);
		const [row] = await db.query(buildHistoryArchiveReadyPressureSql(0));
		expect(row).toEqual({
			outstandingObjects: 1,
			outstandingObjectsCapped: false,
			pressureUnavailable: false,
			recentCompletions: null
		});
	});
	it('includes potential canonical work even before its stored priority is refreshed', async () => {
		const root = 'https://canonical-pressure.example';
		const checkpoint = await db
			.getRepository(HistoryArchiveObject)
			.save(
				createEvidenceObject(
					root,
					'checkpoint-state:0000003f',
					'checkpoint-state',
					'pending'
				)
			);
		await db.query(`insert into full_history_promotion_runtime(network_passphrase_hash,checkpoint_ledger,state) values(sha256(convert_to('test','UTF8')),63,'promoting');
		insert into history_archive_state_snapshot("archiveUrl","archiveUrlIdentity","stateUrl",status,"observedAt",source,"networkPassphrase") values('${root}','${root}','${root}/state','available',now(),'network-scan','test')`);
		await db.query(
			`insert into history_archive_object_ready("objectRemoteId","archiveUrlIdentity",priority,"availableAt") values($1,$2,2,now())`,
			[checkpoint.remoteId, root]
		);
		const rows = await db.query(
			`with ${buildHistoryArchiveOutstandingReadyCountCtesSql(0, false, undefined, 128)} select "objectRemoteId" from ready_probe_candidates`
		);
		expect(rows).toEqual([{ objectRemoteId: checkpoint.remoteId }]);
	});
	it('filters excluded hosts before they can consume the examined window', async () => {
		const previous = process.env.HISTORY_ARCHIVE_EXCLUDED_HOSTS;
		process.env.HISTORY_ARCHIVE_EXCLUDED_HOSTS = 'excluded.example';
		try {
			const objects = Array.from({ length: 140 }, (_, i) =>
				createEvidenceObject(
					`https://excluded.example/${i}`,
					'root',
					'history-archive-state',
					'pending'
				)
			);
			objects.push(
				createEvidenceObject(
					'https://allowed.example',
					'root',
					'history-archive-state',
					'pending'
				)
			);
			await db.getRepository(HistoryArchiveObject).save(objects);
			await db.query(
				`insert into history_archive_object_ready("objectRemoteId","archiveUrlIdentity",priority,"availableAt","dispatchToken") select "remoteId","archiveUrlIdentity",0,now(),gen_random_uuid() from history_archive_object_queue`
			);
			const [row] = await db.query(buildHistoryArchiveReadyPressureSql(0));
			expect(row).toEqual({
				outstandingObjects: 1,
				outstandingObjectsCapped: false,
				pressureUnavailable: false,
				recentCompletions: null
			});
		} finally {
			if (previous === undefined)
				delete process.env.HISTORY_ARCHIVE_EXCLUDED_HOSTS;
			else process.env.HISTORY_ARCHIVE_EXCLUDED_HOSTS = previous;
		}
	});
});
