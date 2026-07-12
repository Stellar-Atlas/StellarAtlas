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
import { createCanonicalFrontierTestSchema } from './HistoryArchiveCanonicalFrontierTestSchema.js';
import {
	createCheckpoint,
	createObject,
	createRoot
} from './HistoryArchiveObjectExecutionTestFixtures.js';

const networkPassphrase = 'Bidirectional canonical frontier network';
const forwardCheckpoint = 1_000_063;
const historicalCheckpoint = forwardCheckpoint - 64;
const rootCount = 24;

jest.setTimeout(60_000);

describe('bidirectional canonical archive frontier', () => {
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
		for (let index = 0; index < rootCount; index += 1) {
			await seedArchive(dataSource, index);
		}
		await seedTargets(dataSource);
	});

	afterAll(async () => {
		if (dataSource?.isInitialized) await dataSource.destroy();
		if (postgres !== undefined) await postgres.stop();
	});

	it('materializes both targets and reserves a fair bounded share for each', async () => {
		await dataSource.query(materializeCanonicalFrontierDependenciesSql);
		const materialized = (await dataSource.query(
			`select "checkpointLedger", count(*)::integer as count
			 from "history_archive_object_queue"
			 where "objectType" = 'checkpoint-state'
				and "dependenciesMaterializedAt" is not null
			 group by "checkpointLedger" order by "checkpointLedger"`
		)) as readonly CheckpointCount[];
		expect(materialized).toEqual([
			{ checkpointLedger: historicalCheckpoint, count: rootCount },
			{ checkpointLedger: forwardCheckpoint, count: rootCount }
		]);

		const [admission] = (await dataSource.query(
			admitCanonicalFrontierSql,
			[24, 24, 2]
		)) as readonly { readonly count: number }[];
		const reservations = (await dataSource.query(
			`select "checkpointLedger", count(*)::integer as count
			 from "history_archive_object_queue"
			 where "executionReason" = 'canonical-frontier-reserve'
			 group by "checkpointLedger" order by "checkpointLedger"`
		)) as readonly CheckpointCount[];
		const perHost = (await dataSource.query(
			`select count(*)::integer as count
			 from "history_archive_object_queue"
			 where "executionReason" = 'canonical-frontier-reserve'
			 group by "hostIdentity"`
		)) as readonly { readonly count: number }[];
		const [runnable] = (await dataSource.query(
			`select count(*)::integer as count
			 from "history_archive_object_queue"
			 where status = 'pending'
				and "executionDisposition" = 'executable'
				and "dependencyReady" = true`
		)) as readonly { readonly count: number }[];

		expect(admission?.count).toBe(24);
		expect(reservations).toEqual([
			{ checkpointLedger: historicalCheckpoint, count: 12 },
			{ checkpointLedger: forwardCheckpoint, count: 12 }
		]);
		expect(perHost.every((row) => row.count <= 2)).toBe(true);
		expect(runnable?.count).toBeLessThanOrEqual(24);
	});
});

interface CheckpointCount {
	readonly checkpointLedger: number;
	readonly count: number;
}

async function seedArchive(
	dataSource: DataSource,
	index: number
): Promise<void> {
	const root = createRoot(index);
	const historicalState = verifiedCheckpoint(index, historicalCheckpoint);
	const forwardState = verifiedCheckpoint(index, forwardCheckpoint);
	const generic = createCheckpoint(index, 63);
	generic.dependencyReady = true;
	generic.executionDisposition = 'executable';
	generic.executionReason = 'frontier-admitted';
	const historicalLedger = archiveObject(
		index,
		'ledger',
		historicalCheckpoint,
		'verified',
		20
	);
	const historicalCategories = ['transactions', 'results', 'scp'].map(
		(type, typeIndex) =>
			archiveObject(
				index,
				type as HistoryArchiveObject['objectType'],
				historicalCheckpoint,
				'pending',
				30 + typeIndex * 10
			)
	);
	const forwardCategories = ['ledger', 'transactions', 'results', 'scp'].map(
		(type, typeIndex) =>
			archiveObject(
				index,
				type as HistoryArchiveObject['objectType'],
				forwardCheckpoint,
				'pending',
				20 + typeIndex * 10
			)
	);
	await dataSource
		.getRepository(HistoryArchiveObject)
		.save([
			root,
			historicalState,
			forwardState,
			generic,
			historicalLedger,
			...historicalCategories,
			...forwardCategories
		]);
	await dataSource.query(
		`insert into "history_archive_state_snapshot" (
			"archiveUrlIdentity", status, "networkPassphrase"
		 ) values ($1, 'available', $2)`,
		[root.archiveUrlIdentity, networkPassphrase]
	);
}

function verifiedCheckpoint(
	index: number,
	checkpointLedger: number
): HistoryArchiveObject {
	const checkpoint = createCheckpoint(index, checkpointLedger);
	checkpoint.status = 'verified';
	checkpoint.verificationFacts = {
		checkpointHistoryArchiveState: {
			stellarHistory: { currentBuckets: [], hotArchiveBuckets: [] }
		}
	} as HistoryArchiveObject['verificationFacts'];
	return checkpoint;
}

function archiveObject(
	index: number,
	objectType: HistoryArchiveObject['objectType'],
	checkpointLedger: number,
	status: HistoryArchiveObject['status'],
	objectOrder: number
): HistoryArchiveObject {
	return createObject(index, {
		checkpointLedger,
		objectKey: `${objectType}:${checkpointLedger
			.toString(16)
			.padStart(8, '0')}`,
		objectOrder,
		objectType,
		status
	});
}

async function seedTargets(dataSource: DataSource): Promise<void> {
	const networkHash = createHash('sha256')
		.update(networkPassphrase, 'utf8')
		.digest();
	await dataSource.query(
		`insert into "full_history_promotion_runtime" (
			"network_passphrase_hash", state, "checkpoint_ledger"
		 ) values ($1, 'waiting-for-proof', $2)`,
		[networkHash, forwardCheckpoint]
	);
	await dataSource.query(
		`insert into "full_history_watermark" (
			"network_passphrase_hash", "first_ledger"
		 ) values ($1, $2)`,
		[networkHash, historicalCheckpoint + 1]
	);
	await dataSource.query(
		`insert into "full_history_historical_backfill_job" (
			id, "network_passphrase_hash", "first_checkpoint_ledger",
			"last_checkpoint_ledger", state
		 ) values ($1, $2, $3, $3, 'pending')`,
		['00000000-0000-4000-8000-000000008001', networkHash, historicalCheckpoint]
	);
}
