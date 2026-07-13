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
import { admitCanonicalFrontierSql } from '../HistoryArchiveCanonicalFrontierSql.js';
import { TypeOrmHistoryArchiveObjectRepository } from '../TypeOrmHistoryArchiveObjectRepository.js';
import { createCanonicalFrontierTestSchema } from './HistoryArchiveCanonicalFrontierTestSchema.js';
import {
	createCheckpoint,
	createRoot
} from './HistoryArchiveObjectExecutionTestFixtures.js';

const networkPassphrase = 'Pending canonical checkpoint fixture network';
const forwardCheckpoint = 1_000_063;
const historicalCheckpoint = forwardCheckpoint - 64;

jest.setTimeout(60_000);

describe('pending canonical runtime checkpoint admission', () => {
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
			update "history_archive_object_claim_slot"
			set "objectRemoteId" = null, "claimedAt" = null
		`);
	});

	afterAll(async () => {
		if (dataSource?.isInitialized) await dataSource.destroy();
		if (postgres !== undefined) await postgres.stop();
	});

	it('reserves and claims an ordinary pending forward target checkpoint', async () => {
		await seedPendingCheckpoint(forwardCheckpoint);
		await seedForwardTarget(forwardCheckpoint);

		await expectPendingCheckpointToBeAdmittedAndClaimed(forwardCheckpoint);
	});

	it('reserves and claims an ordinary pending historical target checkpoint', async () => {
		await seedPendingCheckpoint(historicalCheckpoint);
		await seedHistoricalTarget(historicalCheckpoint);

		await expectPendingCheckpointToBeAdmittedAndClaimed(historicalCheckpoint);
	});

	async function expectPendingCheckpointToBeAdmittedAndClaimed(
		checkpointLedger: number
	): Promise<void> {
		const [admission] = (await dataSource.query(admitCanonicalFrontierSql, [
			1,
			1,
			1
		])) as readonly { readonly count: number }[];
		const [reserved] = (await dataSource.query(
			`select status, "dependencyReady", "executionDisposition",
				"executionReason"
			 from "history_archive_object_queue"
			 where "objectType" = 'checkpoint-state'
				and "checkpointLedger" = $1`,
			[checkpointLedger]
		)) as readonly ReservedCheckpoint[];

		expect(admission?.count).toBe(1);
		expect(reserved).toEqual({
			dependencyReady: true,
			executionDisposition: 'executable',
			executionReason: 'canonical-frontier-reserve',
			status: 'pending'
		});

		const claimed = await repository.claimNextObject(['checkpoint-state']);
		expect(claimed).toMatchObject({
			checkpointLedger,
			status: 'scanning'
		});
		const [persistedClaim] = (await dataSource.query(
			`select status, "executionReason"
			 from "history_archive_object_queue"
			 where "remoteId" = $1`,
			[claimed?.remoteId]
		)) as readonly Pick<
			ReservedCheckpoint,
			'executionReason' | 'status'
		>[];
		expect(persistedClaim).toEqual({
			executionReason: 'canonical-frontier-reserve',
			status: 'scanning'
		});
	}

	async function seedPendingCheckpoint(checkpointLedger: number): Promise<void> {
		const root = createRoot(0);
		const checkpoint = createCheckpoint(0, checkpointLedger);
		checkpoint.dependencyReady = true;
		checkpoint.executionDisposition = null;
		checkpoint.executionReason = null;
		await dataSource
			.getRepository(HistoryArchiveObject)
			.save([root, checkpoint]);
		await dataSource.query(
			`insert into "history_archive_state_snapshot" (
				"archiveUrlIdentity", status, "networkPassphrase"
			 ) values ($1, 'available', $2)`,
			[root.archiveUrlIdentity, networkPassphrase]
		);
	}

	async function seedForwardTarget(checkpointLedger: number): Promise<void> {
		await dataSource.query(
			`insert into "full_history_promotion_runtime" (
				"network_passphrase_hash", state, "checkpoint_ledger"
			 ) values ($1, 'waiting-for-proof', $2)`,
			[networkHash(), checkpointLedger]
		);
	}

	async function seedHistoricalTarget(checkpointLedger: number): Promise<void> {
		await dataSource.query(
			`insert into "full_history_watermark" (
				"network_passphrase_hash", "first_ledger"
			 ) values ($1, $2)`,
			[networkHash(), checkpointLedger + 1]
		);
		await dataSource.query(
			`insert into "full_history_historical_backfill_job" (
				id, "network_passphrase_hash", "first_checkpoint_ledger",
				"last_checkpoint_ledger", state
			 ) values ($1, $2, $3, $3, 'pending')`,
			[
				'00000000-0000-4000-8000-000000008101',
				networkHash(),
				checkpointLedger
			]
		);
	}
});

interface ReservedCheckpoint {
	readonly dependencyReady: boolean;
	readonly executionDisposition: string | null;
	readonly executionReason: string | null;
	readonly status: string;
}

function networkHash(): Buffer {
	return createHash('sha256').update(networkPassphrase, 'utf8').digest();
}
