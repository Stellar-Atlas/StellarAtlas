import { createHash } from 'node:crypto';
import { DataSource } from 'typeorm';
import { HistoryArchiveCheckpointProof } from '../../../../domain/history-archive-checkpoint-proof/HistoryArchiveCheckpointProof.js';
import { HistoryArchiveObject } from '../../../../domain/history-archive-object/HistoryArchiveObject.js';
import { HistoryArchiveObjectEventMigration1784370000000 } from '../../../database/migrations/1784370000000-HistoryArchiveObjectEventMigration.js';
import { HistoryArchiveObjectHostThrottleMigration1784410000000 } from '../../../database/migrations/1784410000000-HistoryArchiveObjectHostThrottleMigration.js';
import { HistoryArchiveObjectClaimCursorMigration1784780000000 } from '../../../database/migrations/1784780000000-HistoryArchiveObjectClaimCursorMigration.js';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import {
	admitCanonicalFrontierSql,
	materializeCanonicalFrontierDependenciesSql
} from '../HistoryArchiveCanonicalFrontierSql.js';
import { TypeOrmHistoryArchiveObjectRepository } from '../TypeOrmHistoryArchiveObjectRepository.js';
import { createCanonicalFrontierTestSchema } from './HistoryArchiveCanonicalFrontierTestSchema.js';
import {
	createBucketMissingProof,
	createCanonicalCheckpointFacts,
	createCanonicalObject as object
} from './HistoryArchiveObjectExecutionTestFixtures.js';

const networkPassphrase = 'Canonical evidence priority fixture';
const targetCheckpoint = 1_000_063;
const bucketHash = 'ab'.repeat(32);
jest.setTimeout(60_000);

describe('canonical archive evidence priority', () => {
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
	});

	afterAll(async () => {
		if (dataSource?.isInitialized) await dataSource.destroy();
		if (postgres !== undefined) await postgres.stop();
	});

	it('revalidates a legacy category without source-specific facts', async () => {
		await seedArchive(0);
		await seedRuntime();
		await dataSource.query(`
			update "history_archive_object_queue"
			set status = 'verified', "verifiedAt" = now(),
				"verificationFacts" = null
			where "objectType" = 'ledger'
				and "checkpointLedger" = ${targetCheckpoint}
		`);

		await repository.reconcileExecutionDisposition();
		const [ledger] = (await dataSource.query(`
			select status, "verifiedAt", "dependencyReady",
				"executionDisposition", "executionReason"
			from "history_archive_object_queue"
			where "objectType" = 'ledger'
				and "checkpointLedger" = ${targetCheckpoint}
		`)) as readonly RevalidationRow[];

		expect(ledger).toEqual({
			dependencyReady: true,
			executionDisposition: 'deferred',
			executionReason: 'canonical-proof-revalidation',
			status: 'pending',
			verifiedAt: null
		});
	});

	it('prefers complete cross-file facts over bucket-only progress', async () => {
		await seedArchive(0);
		await seedArchive(1);
		await seedRuntime();
		const bucketHeavy = createBucketMissingProof(
			'https://canonical-0.example/history',
			targetCheckpoint
		);
		bucketHeavy.expectedBucketCount = 41;
		bucketHeavy.verifiedBucketCount = 40;
		bucketHeavy.missingBucketCount = 1;
		bucketHeavy.proofFactsComplete = false;
		bucketHeavy.failureKind = 'proof-facts-incomplete';
		const promotableFacts = createBucketMissingProof(
			'https://canonical-1.example/history',
			targetCheckpoint
		);
		promotableFacts.expectedBucketCount = 41;
		promotableFacts.verifiedBucketCount = 20;
		promotableFacts.missingBucketCount = 21;
		await dataSource
			.getRepository(HistoryArchiveCheckpointProof)
			.save([bucketHeavy, promotableFacts]);
		await dataSource.query(materializeCanonicalFrontierDependenciesSql);

		await dataSource.query(admitCanonicalFrontierSql, [1, 2]);
		const rows = (await dataSource.query(`
			select "archiveUrlIdentity"
			from "history_archive_object_queue"
			where "executionReason" = 'canonical-frontier-reserve'
		`)) as readonly { readonly archiveUrlIdentity: string }[];

		expect(rows).toEqual([
			{ archiveUrlIdentity: 'https://canonical-1.example/history' }
		]);
	});

	it('replaces a generic proof reservation with canonical frontier work', async () => {
		await seedArchive(0);
		await seedRuntime();
		await dataSource.query(materializeCanonicalFrontierDependenciesSql);
		await dataSource.query(`
			update "history_archive_object_queue"
			set "executionDisposition" = 'executable',
				"executionReason" = 'proof-completion-reserve',
				"dependencyReady" = true
			where "objectType" = 'ledger'
				and "checkpointLedger" = ${targetCheckpoint}
		`);

		await dataSource.query(admitCanonicalFrontierSql, [1, 2]);
		const [ledger] = (await dataSource.query(`
			select "executionDisposition", "executionReason"
			from "history_archive_object_queue"
			where "objectType" = 'ledger'
				and "checkpointLedger" = ${targetCheckpoint}
		`)) as readonly ExecutionRow[];
		const [reserved] = (await dataSource.query(`
			select count(*)::integer as count
			from "history_archive_object_queue"
			where "executionReason" = 'canonical-frontier-reserve'
		`)) as readonly { readonly count: number }[];

		expect(ledger).toEqual({
			executionDisposition: 'deferred',
			executionReason: 'proof-completion-waiting'
		});
		expect(reserved?.count).toBe(1);
	});

	it('replaces saturated generic work from unrelated archive sources', async () => {
		await seedArchive(0);
		await seedRuntime();
		await dataSource.query(materializeCanonicalFrontierDependenciesSql);
		const genericRows = Array.from({ length: 48 }, (_, index) => {
			const generic = object(
				index + 100,
				'checkpoint-state',
				'checkpoint-state:0000003f',
				63
			);
			generic.dependencyReady = true;
			generic.executionDisposition = 'executable';
			generic.executionReason = 'frontier-admitted';
			return generic;
		});
		await dataSource.getRepository(HistoryArchiveObject).save(genericRows);

		const [admission] = (await dataSource.query(
			admitCanonicalFrontierSql,
			[1, 2]
		)) as readonly { readonly count: number }[];
		const [counts] = (await dataSource.query(`
			select
				count(*) filter (
					where "executionReason" = 'canonical-frontier-reserve'
				)::integer as canonical,
				count(*) filter (
					where "executionReason" = 'frontier-waiting'
				)::integer as displaced,
				count(*) filter (
					where "executionReason" = 'frontier-admitted'
						and "executionDisposition" = 'executable'
				)::integer as generic
			from "history_archive_object_queue"
		`)) as readonly {
			readonly canonical: number;
			readonly displaced: number;
			readonly generic: number;
		}[];

		expect(admission?.count).toBe(1);
		expect(counts).toEqual({ canonical: 1, displaced: 1, generic: 47 });
	});

	it('does not let an unrelated retry hide canonical frontier work', async () => {
		await seedArchive(0);
		await seedRuntime();
		await dataSource.query(materializeCanonicalFrontierDependenciesSql);
		await dataSource.query(`
			update "history_archive_object_queue"
			set status = 'failed', "executionDisposition" = 'executable',
				"executionReason" = 'retry-preserved',
				"dependencyReady" = true, "nextAttemptAt" = now() - interval '1 minute'
			where "objectType" = 'ledger'
				and "checkpointLedger" = ${targetCheckpoint}
		`);

		await dataSource.query(admitCanonicalFrontierSql, [1, 2]);
		const [reserved] = (await dataSource.query(`
			select count(*)::integer as count
			from "history_archive_object_queue"
			where "executionReason" = 'canonical-frontier-reserve'
		`)) as readonly { readonly count: number }[];

		expect(reserved?.count).toBe(1);
	});

	async function seedArchive(index: number): Promise<void> {
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
		checkpoint.verificationFacts = createCanonicalCheckpointFacts(
			bucketHash,
			checkpoint.objectUrl,
			targetCheckpoint
		);
		const predecessor = object(
			index,
			'checkpoint-state',
			`checkpoint-state:${(targetCheckpoint - 64)
				.toString(16)
				.padStart(8, '0')}`,
			targetCheckpoint - 64,
			'verified'
		);
		const ledger = object(
			index,
			'ledger',
			`ledger:${targetCheckpoint.toString(16).padStart(8, '0')}`,
			targetCheckpoint
		);
		const bucket = object(index, 'bucket', `bucket:${bucketHash}`, null);
		bucket.bucketHash = bucketHash;
		await dataSource
			.getRepository(HistoryArchiveObject)
			.save([root, checkpoint, predecessor, ledger, bucket]);
		await dataSource.query(
			`insert into "history_archive_state_snapshot" (
				"archiveUrlIdentity", status, "networkPassphrase"
			 ) values ($1, 'available', $2)`,
			[root.archiveUrlIdentity, networkPassphrase]
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
});

interface RevalidationRow {
	readonly dependencyReady: boolean;
	readonly executionDisposition: string | null;
	readonly executionReason: string | null;
	readonly status: string;
	readonly verifiedAt: Date | null;
}

interface ExecutionRow {
	readonly executionDisposition: string | null;
	readonly executionReason: string | null;
}
