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

	it('prioritizes a bucket that can complete a checkpoint proof', async () => {
		const root = createRoot(0);
		const ordinaryRoot = createRoot(1);
		const ordinaryCheckpoint = createCheckpoint(1, 1_000_063);
		const checkpoint = createCheckpoint(0, 1_000_063);
		checkpoint.status = 'verified';
		const ordinary = createBucket(0, 'f'.repeat(64));
		const proofBucket = createBucket(0, '0'.repeat(64));
		proofBucket.status = 'verified';
		await dataSource
			.getRepository(HistoryArchiveObject)
			.save([
				root,
				checkpoint,
				ordinary,
				proofBucket,
				ordinaryRoot,
				ordinaryCheckpoint
			]);
		await dataSource
			.getRepository(HistoryArchiveCheckpointProof)
			.save(
				createBucketMissingProof(
					root.archiveUrl,
					proofBucket.checkpointLedger ?? 0
				)
			);
		await dataSource.query(
			`insert into "history_archive_checkpoint_bucket_dependency" (
				"archiveUrlIdentity", "checkpointLedger", "bucketHash"
			) values ($1, $2, $3)`,
			[
				root.archiveUrlIdentity,
				proofBucket.checkpointLedger,
				proofBucket.bucketHash
			]
		);

		const result = await repository.reconcileExecutionDisposition();
		const proofExecutable = await dataSource
			.getRepository(HistoryArchiveObject)
			.findOneBy({ executionReason: 'proof-completion-reserve' });
		const ordinaryExecutable = await dataSource
			.getRepository(HistoryArchiveObject)
			.findOneBy({
				executionReason: 'frontier-admitted',
				remoteId: ordinaryCheckpoint.remoteId
			});

		expect(result.admittedObjects).toBe(2);
		expect(result.cursorAdvances).toBeGreaterThan(0);
		expect(proofExecutable?.remoteId).toBe(proofBucket.remoteId);
		expect(proofExecutable?.status).toBe('pending');
		expect(ordinaryExecutable?.status).toBe('pending');
	});

	it('deduplicates proof references before applying reserve limits', async () => {
		const rootCount = 4;
		const bucketsPerRoot = 8;
		const referencesPerBucket = 3;
		const roots = Array.from({ length: rootCount }, (_, index) =>
			createRoot(index)
		);
		const buckets = roots.flatMap((_, rootIndex) =>
			Array.from({ length: bucketsPerRoot }, (_, bucketIndex) => {
				const bucket = createBucket(
					rootIndex,
					`${rootIndex.toString(16)}${bucketIndex.toString(16)}`.padEnd(64, '0')
				);
				bucket.status = 'verified';
				return bucket;
			})
		);
		await dataSource
			.getRepository(HistoryArchiveObject)
			.save([...roots, ...buckets]);

		for (let rootIndex = 0; rootIndex < rootCount; rootIndex += 1) {
			for (
				let bucketIndex = 0;
				bucketIndex < bucketsPerRoot;
				bucketIndex += 1
			) {
				const bucket = buckets[rootIndex * bucketsPerRoot + bucketIndex];
				for (
					let referenceIndex = 0;
					referenceIndex < referencesPerBucket;
					referenceIndex += 1
				) {
					const checkpointLedger =
						1_000_063 -
						(bucketIndex * referencesPerBucket + referenceIndex) * 64;
					await dataSource
						.getRepository(HistoryArchiveCheckpointProof)
						.save(
							createBucketMissingProof(
								roots[rootIndex].archiveUrl,
								checkpointLedger
							)
						);
					await dataSource.query(
						`insert into "history_archive_checkpoint_bucket_dependency" (
							"archiveUrlIdentity", "checkpointLedger", "bucketHash"
						) values ($1, $2, $3)`,
						[
							roots[rootIndex].archiveUrlIdentity,
							checkpointLedger,
							bucket?.bucketHash
						]
					);
				}
			}
		}

		const result = await repository.reconcileExecutionDisposition();
		const admittedByRoot = (await dataSource.query(`
			select "archiveUrlIdentity", count(*)::integer as count
			from "history_archive_object_queue"
			where "executionReason" = 'proof-completion-reserve'
			group by "archiveUrlIdentity"
			order by "archiveUrlIdentity"
		`)) as readonly {
			readonly count: number;
			readonly archiveUrlIdentity: string;
		}[];

		expect(result.admittedObjects).toBe(rootCount);
		expect(admittedByRoot).toHaveLength(rootCount);
		expect(admittedByRoot.map(({ count }) => count)).toEqual([1, 1, 1, 1]);

		await dataSource.query(`
			update "history_archive_object_queue"
			set status = 'pending',
				"dependencyReady" = true,
				"executionDisposition" = 'executable',
				"executionReason" = 'proof-completion-reserve'
			where "objectType" = 'bucket'
		`);

		const second = await repository.reconcileExecutionDisposition();
		const [reserve] = (await dataSource.query(`
			select count(*)::integer as count,
				count(distinct "archiveUrlIdentity")::integer as roots
			from "history_archive_object_queue"
			where "executionReason" = 'proof-completion-reserve'
				and "executionDisposition" = 'executable'
				and status in ('pending', 'scanning')
		`)) as readonly { readonly count: number; readonly roots: number }[];
		const [waiting] = (await dataSource.query(`
			select count(*)::integer as count
			from "history_archive_object_queue"
			where "executionReason" = 'proof-completion-waiting'
				and "executionDisposition" = 'deferred'
				and status = 'pending'
		`)) as readonly { readonly count: number }[];

		expect(second.admittedObjects).toBe(0);
		expect(reserve).toEqual({ count: rootCount, roots: rootCount });
		expect(waiting?.count).toBe(rootCount * (bucketsPerRoot - 1));
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

	it('reserves a bounded worker share for due failed retries', async () => {
		const objects = Array.from({ length: 24 }, (_, index) => {
			const failed = createCheckpoint(index, 900_031);
			failed.status = 'failed';
			failed.objectKey = `checkpoint-state:failed-${index}`;
			failed.nextAttemptAt = new Date(Date.now() - 60_000);
			return [createRoot(index), createCheckpoint(index, 1_000_063), failed];
		}).flat();
		for (const object of objects) {
			object.executionDisposition = 'executable';
			object.dependencyReady = true;
		}
		await dataSource.getRepository(HistoryArchiveObject).save(objects);

		const claims = await Promise.all(
			Array.from({ length: 24 }, () =>
				repository.claimNextObject(['checkpoint-state'])
			)
		);
		const failedClaims = claims.filter((claim) =>
			claim?.objectKey.includes(':failed-')
		);
		expect(claims.filter((claim) => claim !== null)).toHaveLength(24);
		expect(failedClaims.length).toBeGreaterThanOrEqual(6);
		expect(failedClaims.length).toBeLessThanOrEqual(12);
	});
});

function createRoot(index: number): HistoryArchiveObject {
	return createObject(index, {
		objectKey: 'root',
		objectOrder: 0,
		objectType: 'history-archive-state',
		status: 'verified'
	});
}

function createCheckpoint(index: number, checkpointLedger: number) {
	return createObject(index, {
		checkpointLedger,
		objectKey: `checkpoint-state:${checkpointLedger.toString(16).padStart(8, '0')}`,
		objectOrder: 10,
		objectType: 'checkpoint-state'
	});
}

function createBucket(index: number, bucketHash: string): HistoryArchiveObject {
	const object = createObject(index, {
		checkpointLedger: 1_000_063,
		objectKey: `bucket:${bucketHash}`,
		objectOrder: 60,
		objectType: 'bucket'
	});
	object.bucketHash = bucketHash;
	return object;
}

function createBucketMissingProof(
	archiveUrl: string,
	checkpointLedger: number
): HistoryArchiveCheckpointProof {
	const proof = new HistoryArchiveCheckpointProof();
	proof.archiveUrl = archiveUrl;
	proof.archiveUrlIdentity = archiveUrl;
	proof.checkpointLedger = checkpointLedger;
	proof.status = 'not-evaluable';
	proof.proofVersion = 5;
	proof.requiredObjectsComplete = true;
	proof.proofFactsComplete = true;
	proof.checkpointBucketListMatches = true;
	proof.transactionsMatch = true;
	proof.resultsMatch = true;
	proof.previousLedgersMatch = true;
	proof.bucketsVerified = false;
	proof.ledgerFactCount = 64;
	proof.transactionFactCount = 64;
	proof.resultFactCount = 64;
	proof.expectedBucketCount = 1;
	proof.verifiedBucketCount = 0;
	proof.failedBucketCount = 0;
	proof.missingBucketCount = 1;
	proof.checkpointBucketListHash = null;
	proof.ledgerBucketListHash = null;
	proof.checkpointStateObjectRemoteId = null;
	proof.ledgerObjectRemoteId = null;
	proof.transactionsObjectRemoteId = null;
	proof.resultsObjectRemoteId = null;
	proof.scpObjectRemoteId = null;
	proof.failureKind = 'bucket-missing';
	proof.details = null;
	proof.evaluatedAt = new Date();
	return proof;
}

function createObject(
	index: number,
	props: Pick<
		ConstructorParameters<typeof HistoryArchiveObject>[0] & object,
		'checkpointLedger' | 'objectKey' | 'objectOrder' | 'objectType' | 'status'
	>
): HistoryArchiveObject {
	const archiveUrl = `https://archive-${index}.example/history`;
	const object = new HistoryArchiveObject({
		archiveUrl,
		archiveUrlIdentity: archiveUrl,
		checkpointLedger: props.checkpointLedger,
		executionDisposition: 'deferred',
		objectKey: props.objectKey,
		objectOrder: props.objectOrder,
		objectType: props.objectType,
		objectUrl: `${archiveUrl}/${props.objectKey}`,
		status: props.status ?? 'pending'
	});
	object.dependencyReady = null;
	object.executionReason = 'legacy-planning-intent';
	return object;
}
