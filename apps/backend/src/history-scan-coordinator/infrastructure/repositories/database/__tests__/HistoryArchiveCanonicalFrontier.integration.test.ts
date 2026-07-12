import { createHash } from 'node:crypto';
import { DataSource } from 'typeorm';
import { HistoryArchiveCheckpointProof } from '../../../../domain/history-archive-checkpoint-proof/HistoryArchiveCheckpointProof.js';
import { HistoryArchiveObject } from '../../../../domain/history-archive-object/HistoryArchiveObject.js';
import { HistoryArchiveObjectEventMigration1784370000000 } from '../../../database/migrations/1784370000000-HistoryArchiveObjectEventMigration.js';
import { HistoryArchiveObjectHostThrottleMigration1784410000000 } from '../../../database/migrations/1784410000000-HistoryArchiveObjectHostThrottleMigration.js';
import { HistoryArchiveObjectClaimCursorMigration1784780000000 } from '../../../database/migrations/1784780000000-HistoryArchiveObjectClaimCursorMigration.js';
import { TypeOrmHistoryArchiveObjectRepository } from '../TypeOrmHistoryArchiveObjectRepository.js';
import { createCanonicalFrontierTestSchema } from './HistoryArchiveCanonicalFrontierTestSchema.js';
import {
	createBucketMissingProof,
	createCheckpoint,
	createRoot
} from './HistoryArchiveObjectExecutionTestFixtures.js';
import {
	admitCanonicalFrontierSql,
	materializeCanonicalFrontierDependenciesSql
} from '../HistoryArchiveCanonicalFrontierSql.js';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';

const networkPassphrase = 'Canonical frontier fixture network';
const targetCheckpoint = 1_000_063;
const bucketHash = 'ab'.repeat(32);

jest.setTimeout(60_000);

describe('canonical full-history archive frontier', () => {
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
		await createCanonicalFrontierTestSchema(dataSource);
		repository = new TypeOrmHistoryArchiveObjectRepository(
			dataSource.getRepository(HistoryArchiveObject)
		);
	});

	beforeEach(async () => {
		await dataSource.query(
			'truncate "history_archive_checkpoint_proof", "history_archive_object_event", "history_archive_object_queue", "history_archive_object_frontier_cursor", "history_archive_checkpoint_bucket_dependency", "history_archive_state_snapshot", "full_history_historical_backfill_job", "full_history_watermark", "full_history_promotion_runtime" restart identity cascade'
		);
		await dataSource.query(`
			update "history_archive_reconciliation_state"
			set "admittedRows" = 0, "updatedAt" = now()
			where name = 'execution-disposition'
		`);
	});

	afterAll(async () => {
		if (dataSource?.isInitialized) await dataSource.destroy();
		if (postgres !== undefined) await postgres.stop();
	});

	it('replaces generic backlog with the exact canonical checkpoint dependencies', async () => {
		const rootCount = 4;
		for (let index = 0; index < rootCount; index += 1) {
			await seedArchive(index);
		}
		await seedRuntime();

		const first = await repository.reconcileExecutionDisposition();
		const canonical = await readCanonicalRows();
		const [counts] = (await dataSource.query(`
			select
				count(*) filter (
					where "dependenciesMaterializedAt" is not null
				)::integer as materialized,
				count(*) filter (
					where "executionReason" = 'frontier-waiting'
				)::integer as displaced
			from "history_archive_object_queue"
			where "objectType" = 'checkpoint-state'
		`)) as readonly {
			readonly displaced: number;
			readonly materialized: number;
		}[];
		const [dependencies] = (await dataSource.query(`
			select count(*)::integer as count
			from "history_archive_checkpoint_bucket_dependency"
		`)) as readonly { readonly count: number }[];

		expect(first.admittedObjects).toBe(rootCount);
		expect(canonical).toHaveLength(rootCount);
		expect(canonical.map((row) => row.checkpointLedger)).toEqual(
			Array.from({ length: rootCount }, () => targetCheckpoint - 64)
		);
		expect(counts).toEqual({ displaced: rootCount, materialized: rootCount });
		expect(dependencies?.count).toBe(rootCount);

		await dataSource.query(`
			update "history_archive_object_queue"
			set status = 'verified', "verifiedAt" = now()
			where "executionReason" = 'canonical-frontier-reserve'
		`);
		const second = await repository.reconcileExecutionDisposition();
		const nextCanonical = await readCanonicalRows('pending');

		expect(second.admittedObjects).toBe(rootCount);
		expect(nextCanonical).toHaveLength(rootCount);
		expect(
			nextCanonical.every((row) => row.checkpointLedger === targetCheckpoint)
		).toBe(true);
	});

	it('does not admit a different network into the canonical reserve', async () => {
		await seedArchive(0, 'A different network');
		await seedRuntime();

		const result = await repository.reconcileExecutionDisposition();
		const canonical = await readCanonicalRows();

		expect(result.admittedObjects).toBe(0);
		expect(canonical).toHaveLength(0);
	});

	it('replaces generic work with a missing target bucket after categories complete', async () => {
		await seedArchive(0);
		await seedRuntime();
		await dataSource.query(`
			update "history_archive_object_queue"
			set status = 'verified', "verifiedAt" = now()
			where "objectType" in ('ledger', 'transactions', 'results', 'scp')
		`);

		const result = await repository.reconcileExecutionDisposition();
		const [bucket] = (await dataSource.query(
			`
			select status, "dependencyReady", "executionDisposition",
				"executionReason"
			from "history_archive_object_queue"
			where "objectType" = 'bucket' and "bucketHash" = $1
		`,
			[bucketHash]
		)) as readonly {
			readonly dependencyReady: boolean;
			readonly executionDisposition: string | null;
			readonly executionReason: string | null;
			readonly status: string;
		}[];
		const [generic] = (await dataSource.query(`
			select "executionDisposition", "executionReason"
			from "history_archive_object_queue"
			where "objectKey" = 'checkpoint-state:0000003f'
		`)) as readonly {
			readonly executionDisposition: string | null;
			readonly executionReason: string | null;
		}[];

		expect(result.admittedObjects).toBe(1);
		expect(bucket).toEqual({
			dependencyReady: true,
			executionDisposition: 'executable',
			executionReason: 'canonical-frontier-reserve',
			status: 'pending'
		});
		expect(generic).toEqual({
			executionDisposition: 'deferred',
			executionReason: 'frontier-waiting'
		});
	});

	it('revalidates legacy bucket rows that lack source-specific proof facts', async () => {
		await seedArchive(0);
		await seedRuntime();
		await dataSource.query(`
			update "history_archive_object_queue"
			set status = 'verified', "verifiedAt" = now()
			where "objectType" in (
				'ledger', 'transactions', 'results', 'scp', 'bucket'
			)
		`);

		const result = await repository.reconcileExecutionDisposition();
		const [bucket] = (await dataSource.query(
			`select status, "verifiedAt", "dependencyReady",
				"executionDisposition", "executionReason"
			 from "history_archive_object_queue"
			 where "objectType" = 'bucket' and "bucketHash" = $1`,
			[bucketHash]
		)) as readonly {
			readonly dependencyReady: boolean;
			readonly executionDisposition: string | null;
			readonly executionReason: string | null;
			readonly status: string;
			readonly verifiedAt: Date | null;
		}[];

		expect(result.admittedObjects).toBe(1);
		expect(bucket).toEqual({
			dependencyReady: true,
			executionDisposition: 'executable',
			executionReason: 'canonical-frontier-reserve',
			status: 'pending',
			verifiedAt: null
		});
	});

	it('reserves the archive source closest to a strict proof first', async () => {
		await seedArchive(0);
		await seedArchive(1);
		await seedRuntime();
		const slower = createBucketMissingProof(
			'https://canonical-0.example/history',
			targetCheckpoint
		);
		slower.expectedBucketCount = 41;
		slower.verifiedBucketCount = 1;
		slower.missingBucketCount = 40;
		const closer = createBucketMissingProof(
			'https://canonical-1.example/history',
			targetCheckpoint
		);
		closer.expectedBucketCount = 41;
		closer.verifiedBucketCount = 27;
		closer.missingBucketCount = 14;
		await dataSource
			.getRepository(HistoryArchiveCheckpointProof)
			.save([slower, closer]);
		await dataSource.query(materializeCanonicalFrontierDependenciesSql);

		await dataSource.query(admitCanonicalFrontierSql, [1, 48, 2]);
		const rows = (await dataSource.query(`
			select "archiveUrlIdentity"
			from "history_archive_object_queue"
			where "executionReason" = 'canonical-frontier-reserve'
		`)) as readonly { readonly archiveUrlIdentity: string }[];

		expect(rows).toEqual([
			{ archiveUrlIdentity: 'https://canonical-1.example/history' }
		]);
	});

	it('reserves a bounded worker share for due failed retries', async () => {
		const objects = Array.from({ length: 24 }, (_, index) => {
			const failed = createCheckpoint(index, 900_031);
			failed.status = 'failed';
			failed.objectKey = `checkpoint-state:failed-${index}`;
			failed.nextAttemptAt = new Date(Date.now() - 60_000);
			return [createRoot(index), createCheckpoint(index, 1_000_063), failed];
		}).flat();
		for (const item of objects) {
			item.executionDisposition = 'executable';
			item.dependencyReady = true;
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

	it('claims canonical proof work before older ordinary frontier work', async () => {
		const ordinaryRoot = object(
			0,
			'history-archive-state',
			'root',
			null,
			'verified'
		);
		ordinaryRoot.lastClaimedAt = new Date('2020-01-01T00:00:00.000Z');
		const ordinary = object(
			0,
			'checkpoint-state',
			'checkpoint-state:0000003f',
			63
		);
		ordinary.dependencyReady = true;
		ordinary.executionDisposition = 'executable';
		ordinary.executionReason = 'planned-frontier';

		const canonicalRoot = object(
			1,
			'history-archive-state',
			'root',
			null,
			'verified'
		);
		canonicalRoot.lastClaimedAt = new Date('2026-01-01T00:00:00.000Z');
		const canonical = object(1, 'bucket', `bucket:${bucketHash}`, null);
		canonical.bucketHash = bucketHash;
		canonical.dependencyReady = true;
		canonical.executionDisposition = 'executable';
		canonical.executionReason = 'canonical-frontier-reserve';

		await dataSource
			.getRepository(HistoryArchiveObject)
			.save([ordinaryRoot, ordinary, canonicalRoot, canonical]);
		await dataSource.query(`
			update "history_archive_object_claim_slot"
			set "objectRemoteId" = null, "claimedAt" = null
		`);

		const claimed = await repository.claimNextObject([
			'checkpoint-state',
			'bucket'
		]);

		expect(claimed).toMatchObject({
			archiveUrlIdentity: canonical.archiveUrlIdentity,
			objectKey: canonical.objectKey
		});
	});

	async function seedArchive(
		index: number,
		archiveNetworkPassphrase = networkPassphrase
	): Promise<void> {
		const archiveUrl = `https://canonical-${index}.example/history`;
		const root = object(
			index,
			'history-archive-state',
			'root',
			null,
			'verified'
		);
		const checkpoint = object(
			index,
			'checkpoint-state',
			`checkpoint-state:${targetCheckpoint.toString(16).padStart(8, '0')}`,
			targetCheckpoint,
			'verified'
		);
		checkpoint.verificationFacts = checkpointFacts();
		const predecessorCheckpoint = object(
			index,
			'checkpoint-state',
			`checkpoint-state:${(targetCheckpoint - 64)
				.toString(16)
				.padStart(8, '0')}`,
			targetCheckpoint - 64,
			'verified'
		);
		const generic = object(
			index,
			'checkpoint-state',
			'checkpoint-state:0000003f',
			63
		);
		generic.executionDisposition = 'executable';
		generic.executionReason = 'frontier-admitted';
		generic.dependencyReady = true;
		const predecessor = object(
			index,
			'ledger',
			`ledger:${(targetCheckpoint - 64).toString(16).padStart(8, '0')}`,
			targetCheckpoint - 64
		);
		const targetObjects = ['ledger', 'transactions', 'results', 'scp'].map(
			(type, typeIndex) =>
				object(
					index,
					type as HistoryArchiveObject['objectType'],
					`${type}:${targetCheckpoint.toString(16).padStart(8, '0')}`,
					targetCheckpoint,
					'pending',
					20 + typeIndex * 10
				)
		);
		const bucket = object(index, 'bucket', `bucket:${bucketHash}`, null);
		bucket.bucketHash = bucketHash;
		await dataSource
			.getRepository(HistoryArchiveObject)
			.save([
				root,
				checkpoint,
				predecessorCheckpoint,
				generic,
				predecessor,
				bucket,
				...targetObjects
			]);
		await dataSource.query(
			`insert into "history_archive_state_snapshot" (
				"archiveUrlIdentity", status, "networkPassphrase"
			) values ($1, 'available', $2)`,
			[archiveUrl, archiveNetworkPassphrase]
		);
	}

	async function seedRuntime(): Promise<void> {
		await dataSource.query(
			`insert into "full_history_promotion_runtime" (
				"network_passphrase_hash", state, "checkpoint_ledger"
			) values ($1, 'waiting-for-proof', $2)`,
			[
				createHash('sha256').update(networkPassphrase, 'utf8').digest(),
				targetCheckpoint
			]
		);
	}

	async function readCanonicalRows(status?: string): Promise<
		readonly {
			readonly checkpointLedger: number;
		}[]
	> {
		return (await dataSource.query(
			`select "checkpointLedger"
			 from "history_archive_object_queue"
			 where "executionReason" = 'canonical-frontier-reserve'
				and ($1::text is null or status = $1)
			 order by "archiveUrlIdentity"`,
			[status ?? null]
		)) as readonly { readonly checkpointLedger: number }[];
	}
});

function object(
	index: number,
	objectType: HistoryArchiveObject['objectType'],
	objectKey: string,
	checkpointLedger: number | null,
	status: HistoryArchiveObject['status'] = 'pending',
	objectOrder = 10
): HistoryArchiveObject {
	const archiveUrl = `https://canonical-${index}.example/history`;
	const item = new HistoryArchiveObject({
		archiveUrl,
		archiveUrlIdentity: archiveUrl,
		checkpointLedger,
		dependencyReady: objectType === 'history-archive-state',
		executionDisposition: 'deferred',
		hostIdentity: `canonical-${index}.example`,
		objectKey,
		objectOrder,
		objectType,
		objectUrl: `${archiveUrl}/${objectKey}`,
		status
	});
	item.executionReason = 'legacy-planning-intent';
	return item;
}

function checkpointFacts(): HistoryArchiveObject['verificationFacts'] {
	return {
		checkpointHistoryArchiveState: {
			stellarHistory: {
				currentBuckets: [{ curr: bucketHash, snap: '0'.repeat(64) }],
				hotArchiveBuckets: []
			}
		}
	} as HistoryArchiveObject['verificationFacts'];
}
