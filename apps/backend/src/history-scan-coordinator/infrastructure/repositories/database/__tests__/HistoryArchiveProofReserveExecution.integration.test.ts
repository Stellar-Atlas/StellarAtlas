import { DataSource } from 'typeorm';
import { HistoryArchiveCheckpointProof } from '../../../../domain/history-archive-checkpoint-proof/HistoryArchiveCheckpointProof.js';
import { HistoryArchiveObject } from '../../../../domain/history-archive-object/HistoryArchiveObject.js';
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
	createBucket,
	createBucketMissingProof,
	createCheckpoint,
	createRoot
} from './HistoryArchiveObjectExecutionTestFixtures.js';

jest.setTimeout(60_000);

describe('history archive proof-reserve execution', () => {
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
		await dataSource.query(`
			update "history_archive_reconciliation_state"
			set "admittedRows" = 0, "updatedAt" = now()
			where name = 'execution-disposition'
		`);
		await dataSource.query(`
			update "history_archive_object_claim_slot"
			set "objectRemoteId" = null, "claimedAt" = null, "updatedAt" = now()
		`);
	});

	afterAll(async () => {
		if (dataSource?.isInitialized) await dataSource.destroy();
		if (postgres !== undefined) await postgres.stop();
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
		await saveProofDependency(dataSource, root, proofBucket, 1_000_063);

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

	it('does not re-admit a verified bucket until its transition effects complete', async () => {
		const root = createRoot(0);
		const checkpoint = createCheckpoint(0, 1_000_063);
		checkpoint.status = 'verified';
		const proofBucket = createBucket(0, 'a'.repeat(64));
		proofBucket.status = 'verified';
		proofBucket.transitionEffectsRequiredAt = new Date();
		proofBucket.transitionEffectsCompletedAt = null;
		await dataSource
			.getRepository(HistoryArchiveObject)
			.save([root, checkpoint, proofBucket]);
		await saveProofDependency(dataSource, root, proofBucket, 1_000_063);

		await repository.reconcileExecutionDisposition();
		const unreconciled = await dataSource
			.getRepository(HistoryArchiveObject)
			.findOneByOrFail({ remoteId: proofBucket.remoteId });
		expect(unreconciled).toMatchObject({
			executionReason: 'legacy-planning-intent',
			status: 'verified',
			transitionEffectsCompletedAt: null
		});

		unreconciled.transitionEffectsCompletedAt = new Date();
		await dataSource.getRepository(HistoryArchiveObject).save(unreconciled);
		await repository.reconcileExecutionDisposition();
		const reconciled = await dataSource
			.getRepository(HistoryArchiveObject)
			.findOneByOrFail({ remoteId: proofBucket.remoteId });
		expect(reconciled).toMatchObject({
			executionDisposition: 'executable',
			executionReason: 'proof-completion-reserve',
			status: 'pending'
		});
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
				const hash =
					`${rootIndex.toString(16)}${bucketIndex.toString(16)}`.padEnd(
						64,
						'0'
					);
				const bucket = createBucket(rootIndex, hash);
				bucket.status = 'verified';
				return bucket;
			})
		);
		await dataSource
			.getRepository(HistoryArchiveObject)
			.save([...roots, ...buckets]);

		for (let rootIndex = 0; rootIndex < rootCount; rootIndex += 1) {
			for (let bucketIndex = 0; bucketIndex < bucketsPerRoot; bucketIndex += 1) {
				const bucket = buckets[rootIndex * bucketsPerRoot + bucketIndex];
				if (bucket === undefined) throw new Error('Expected bucket fixture');
				for (
					let referenceIndex = 0;
					referenceIndex < referencesPerBucket;
					referenceIndex += 1
				) {
					const checkpointLedger =
						1_000_063 -
						(bucketIndex * referencesPerBucket + referenceIndex) * 64;
					await saveProofDependency(
						dataSource,
						roots[rootIndex],
						bucket,
						checkpointLedger
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
		`)) as readonly { readonly count: number }[];

		expect(result.admittedObjects).toBe(rootCount);
		expect(admittedByRoot).toHaveLength(rootCount);
		expect(admittedByRoot.map(({ count }) => count)).toEqual([1, 1, 1, 1]);

		await dataSource.query(`
			update "history_archive_object_queue"
			set status = 'pending', "dependencyReady" = true,
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
});

async function saveProofDependency(
	dataSource: DataSource,
	root: HistoryArchiveObject,
	bucket: HistoryArchiveObject,
	checkpointLedger: number
): Promise<void> {
	await dataSource
		.getRepository(HistoryArchiveCheckpointProof)
		.save(createBucketMissingProof(root.archiveUrl, checkpointLedger));
	await dataSource.query(
		`insert into "history_archive_checkpoint_bucket_dependency" (
			"archiveUrlIdentity", "checkpointLedger", "bucketHash"
		) values ($1, $2, $3)`,
		[root.archiveUrlIdentity, checkpointLedger, bucket.bucketHash]
	);
}
