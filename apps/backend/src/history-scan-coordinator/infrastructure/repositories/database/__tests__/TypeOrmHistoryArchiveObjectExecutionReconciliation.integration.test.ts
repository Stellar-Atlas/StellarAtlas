import { DataSource } from 'typeorm';
import { HistoryArchiveObject } from '../../../../domain/history-archive-object/HistoryArchiveObject.js';
import { HistoryArchiveCheckpointProof } from '../../../../domain/history-archive-checkpoint-proof/HistoryArchiveCheckpointProof.js';
import { HistoryArchiveObjectEventMigration1784370000000 } from '../../../database/migrations/1784370000000-HistoryArchiveObjectEventMigration.js';
import { HistoryArchiveObjectHostThrottleMigration1784410000000 } from '../../../database/migrations/1784410000000-HistoryArchiveObjectHostThrottleMigration.js';
import { HistoryArchiveObjectClaimCursorMigration1784780000000 } from '../../../database/migrations/1784780000000-HistoryArchiveObjectClaimCursorMigration.js';
import { TypeOrmHistoryArchiveObjectRepository } from '../TypeOrmHistoryArchiveObjectRepository.js';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import { createCanonicalFrontierTestSchema } from './HistoryArchiveCanonicalFrontierTestSchema.js';
import {
	createCheckpoint,
	createObject,
	createRoot
} from './HistoryArchiveObjectExecutionTestFixtures.js';

jest.setTimeout(60_000);

describe('history archive execution reconciliation in disposable PostgreSQL', () => {
	let dataSource: DataSource;
	let postgres: DisposablePostgres;
	let repository: TypeOrmHistoryArchiveObjectRepository;

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
		const queryRunner = dataSource.createQueryRunner();
		await new HistoryArchiveObjectEventMigration1784370000000().up(queryRunner);
		await new HistoryArchiveObjectHostThrottleMigration1784410000000().up(
			queryRunner
		);
		await new HistoryArchiveObjectClaimCursorMigration1784780000000().up(
			queryRunner
		);
		await createCanonicalFrontierTestSchema(dataSource);
		await queryRunner.release();
		repository = new TypeOrmHistoryArchiveObjectRepository(
			dataSource.getRepository(HistoryArchiveObject)
		);
	});

	beforeEach(async () => {
		await dataSource.query(
			'truncate "history_archive_checkpoint_proof", "history_archive_object_event", "history_archive_object_queue", "history_archive_object_frontier_cursor", "history_archive_checkpoint_bucket_dependency" restart identity cascade'
		);
		await dataSource.query(
			`update "history_archive_reconciliation_state"
			 set "admittedRows" = 0, "updatedAt" = now()
			 where name = 'execution-disposition'`
		);
		await dataSource.query(`
			update "history_archive_object_claim_slot"
			set "objectRemoteId" = null, "claimedAt" = null, "updatedAt" = now()
		`);
	});

	afterAll(async () => {
		if (dataSource?.isInitialized) await dataSource.destroy();
		if (postgres !== undefined) await postgres.stop();
	});

	it('rotates roots durably without deleting deferred planning intents', async () => {
		const objects = Array.from({ length: 79 }, (_, index) => [
			createRoot(index),
			createCheckpoint(index, 1_000_063)
		]).flat();
		await dataSource.getRepository(HistoryArchiveObject).save(objects);

		const first = await repository.reconcileExecutionDisposition();
		expect(first.admittedObjects).toBe(48);
		expect(first.cursorAdvances).toBe(79);

		await dataSource.query(`
			update "history_archive_object_queue"
			set status = 'verified'
			where status = 'pending' and "executionDisposition" = 'executable'
		`);
		const second = await repository.reconcileExecutionDisposition();
		expect(second.admittedObjects).toBe(31);

		const [counts] = (await dataSource.query(`
			select count(*)::integer as total,
				count(*) filter (
					where "objectType" = 'checkpoint-state'
						and "executionDisposition" = 'executable'
				)::integer as executable
			from "history_archive_object_queue"
		`)) as readonly { readonly executable: number; readonly total: number }[];
		expect(counts).toEqual({ executable: 79, total: 158 });
	});

	it('preserves NULL legacy pending rows until a bounded frontier admits them', async () => {
		const root = createRoot(0);
		const legacy = Array.from({ length: 100 }, (_, index) => {
			const object = createCheckpoint(0, 63 + index * 64);
			object.executionDisposition = null;
			object.executionReason = null;
			object.dependencyReady = null;
			return object;
		});
		await dataSource
			.getRepository(HistoryArchiveObject)
			.save([root, ...legacy]);

		const result = await repository.reconcileExecutionDisposition();
		const [counts] = (await dataSource.query(`
			select
				count(*) filter (
					where "executionDisposition" is null
				)::integer as "legacyDeferred",
				count(*) filter (
					where "executionDisposition" = 'executable'
				)::integer as executable
			from "history_archive_object_queue"
			where "objectType" = 'checkpoint-state'
		`)) as readonly {
			readonly executable: number;
			readonly legacyDeferred: number;
		}[];

		expect(result).toMatchObject({ admittedObjects: 1, cursorAdvances: 1 });
		expect(counts).toEqual({ executable: 1, legacyDeferred: 99 });
	});

	it('rotates equivalent keys and enforces the per-root frontier cap', async () => {
		const root = createRoot(0);
		const checkpoints = Array.from({ length: 12 }, (_, index) =>
			createCheckpoint(0, 63 + index * 64)
		);
		const blockedLedger = createObject(0, {
			checkpointLedger: 50_047,
			objectKey: 'ledger:0000c37f',
			objectOrder: 20,
			objectType: 'ledger'
		});
		blockedLedger.bytesDownloaded = 1234;
		await dataSource
			.getRepository(HistoryArchiveObject)
			.save([root, ...checkpoints, blockedLedger]);

		const admittedKeys = new Set<string>();
		for (let pass = 0; pass < 4; pass += 1) {
			const result = await repository.reconcileExecutionDisposition();
			expect(result.admittedObjects).toBe(1);
			const [active] = (await dataSource.query(`
				select id, "objectKey"
				from "history_archive_object_queue"
				where status = 'pending'
					and "executionDisposition" = 'executable'
				limit 1
			`)) as readonly { readonly id: string; readonly objectKey: string }[];
			expect(active).toBeDefined();
			admittedKeys.add(active?.objectKey ?? '');
			await dataSource.query(
				`update "history_archive_object_queue"
				 set status = 'verified', "verifiedAt" = now()
				 where id = $1`,
				[active?.id]
			);
		}
		expect(admittedKeys.size).toBe(4);

		const fifth = await repository.reconcileExecutionDisposition();
		expect(fifth.admittedObjects).toBe(1);
		const capped = await repository.reconcileExecutionDisposition();
		expect(capped.admittedObjects).toBe(0);

		const [counts] = (await dataSource.query(`
			select count(*) filter (
					where "executionDisposition" = 'executable'
						and status = 'pending'
				)::integer as executable,
				max("bytesDownloaded") filter (
					where "objectType" = 'ledger'
				)::integer as "blockedBytes",
				bool_and("executionDisposition" = 'deferred') filter (
					where "objectType" = 'ledger'
				) as "ledgerDeferred"
			from "history_archive_object_queue"
		`)) as readonly {
			readonly blockedBytes: number;
			readonly executable: number;
			readonly ledgerDeferred: boolean;
		}[];
		expect(counts).toEqual({
			blockedBytes: 1234,
			executable: 1,
			ledgerDeferred: true
		});
	});

	it('redistributes a concentrated runnable backlog across archive roots', async () => {
		const concentratedRoots = Array.from({ length: 6 }, (_, index) =>
			createRoot(index)
		);
		const availableRoots = Array.from({ length: 60 }, (_, index) =>
			createRoot(index + concentratedRoots.length)
		);
		const concentrated = concentratedRoots.flatMap((_, rootIndex) =>
			Array.from({ length: 8 }, (_, itemIndex) => {
				const object = createCheckpoint(rootIndex, 1_000_063 - itemIndex * 64);
				object.executionDisposition = 'executable';
				object.executionReason = 'planned-frontier';
				object.dependencyReady = true;
				return object;
			})
		);
		const available = availableRoots.map((_, index) =>
			createCheckpoint(index + concentratedRoots.length, 1_000_063)
		);
		await dataSource
			.getRepository(HistoryArchiveObject)
			.save([
				...concentratedRoots,
				...availableRoots,
				...concentrated,
				...available
			]);

		const result = await repository.reconcileExecutionDisposition();
		const [distribution] = (await dataSource.query(`
			select count(*)::integer as rows,
				count(distinct "archiveUrlIdentity")::integer as roots,
				max(root_count)::integer as "maxPerRoot"
			from (
				select "archiveUrlIdentity",
					count(*) over (partition by "archiveUrlIdentity") as root_count
				from "history_archive_object_queue"
				where status = 'pending'
					and "executionDisposition" = 'executable'
			) runnable
		`)) as readonly {
			readonly maxPerRoot: number;
			readonly roots: number;
			readonly rows: number;
		}[];

		expect(result.admittedObjects).toBe(42);
		expect(distribution).toEqual({ maxPerRoot: 1, roots: 48, rows: 48 });
	});

	it('preserves retries and admits only to the production idle watermark', async () => {
		const roots = Array.from({ length: 79 }, (_, index) => createRoot(index));
		const pending = Array.from({ length: 79 }, (_, index) =>
			createCheckpoint(index, 1_000_063)
		);
		const scanning = Array.from({ length: 20 }, (_, index) => {
			const object = createObject(index, {
				checkpointLedger: 900_031,
				objectKey: `ledger:scan-${index}`,
				objectOrder: 20,
				objectType: 'ledger',
				status: 'scanning'
			});
			return object;
		});
		const failed = Array.from({ length: 50 }, (_, index) => {
			const object = createObject(index, {
				checkpointLedger: 800_063,
				objectKey: `results:retry-${index}`,
				objectOrder: 40,
				objectType: 'results',
				status: 'failed'
			});
			object.nextAttemptAt = new Date(
				Date.now() + (index < 10 ? -60_000 : 3_600_000)
			);
			return object;
		});
		await dataSource
			.getRepository(HistoryArchiveObject)
			.save([...roots, ...pending, ...scanning, ...failed]);

		const result = await repository.reconcileExecutionDisposition();
		expect(result).toMatchObject({
			admittedObjects: 18,
			outstandingObjects: 30,
			preservedObjects: 70,
			watermark: 48
		});

		const [counts] = (await dataSource.query(`
			select
				count(*) filter (where status = 'scanning')::integer as scanning,
				count(*) filter (
					where status = 'pending'
						and "executionDisposition" = 'executable'
				)::integer as pending,
				count(*) filter (
					where status = 'failed'
						and "executionDisposition" = 'executable'
				)::integer as failed,
				count(*)::integer as total
			from "history_archive_object_queue"
		`)) as readonly {
			readonly failed: number;
			readonly pending: number;
			readonly scanning: number;
			readonly total: number;
		}[];
		expect(counts).toEqual({
			failed: 50,
			pending: 18,
			scanning: 20,
			total: 228
		});
	});
});
