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

	it('keeps the next canonical check reserved behind active work', async () => {
		const root = await seedPendingCheckpoint(forwardCheckpoint);
		const active = createCheckpoint(0, 63);
		active.status = 'scanning';
		active.dependencyReady = true;
		active.executionDisposition = 'executable';
		active.executionReason = 'in-flight-preserved';
		await dataSource.getRepository(HistoryArchiveObject).save(active);
		await dataSource.query(
			`update "history_archive_object_claim_slot"
			 set "objectRemoteId" = $1, "claimedAt" = now()
			 where slot = 0`,
			[active.remoteId]
		);
		await seedForwardTarget(forwardCheckpoint);

		await repository.reconcileExecutionDisposition();
		await repository.reconcileExecutionDisposition();
		const [reserved] = (await dataSource.query(
			`select "executionDisposition", "executionReason"
			 from "history_archive_object_queue"
			 where "archiveUrlIdentity" = $1 and "checkpointLedger" = $2`,
			[root.archiveUrlIdentity, forwardCheckpoint]
		)) as readonly Pick<
			ReservedCheckpoint,
			'executionDisposition' | 'executionReason'
		>[];

		expect(reserved).toEqual({
			executionDisposition: 'executable',
			executionReason: 'canonical-frontier-reserve'
		});
	});

	it('reserves saturated-host work until a host slot is released', async () => {
		const hostIdentity = 'saturated.example';
		const root = await seedPendingCheckpoint(
			forwardCheckpoint,
			2,
			hostIdentity
		);
		const active = [0, 1].map((index) => {
			const item = createCheckpoint(index, 63 + index * 64);
			item.hostIdentity = hostIdentity;
			item.status = 'scanning';
			item.dependencyReady = true;
			item.executionDisposition = 'executable';
			item.executionReason = 'in-flight-preserved';
			return item;
		});
		await dataSource.getRepository(HistoryArchiveObject).save(active);
		await Promise.all(
			active.map((item, slot) =>
				dataSource.query(
					`update "history_archive_object_claim_slot"
					 set "objectRemoteId" = $1, "claimedAt" = now()
					 where slot = $2`,
					[item.remoteId, slot]
				)
			)
		);
		await seedForwardTarget(forwardCheckpoint);

		const firstAdmission = await admitCanonicalTargets();
		const first = await readReservation(root.archiveUrlIdentity);
		const secondAdmission = await admitCanonicalTargets();
		const second = await readReservation(root.archiveUrlIdentity);

		expect(firstAdmission).toBe(1);
		expect(secondAdmission).toBe(0);
		expect(first).toMatchObject({
			executionDisposition: 'executable',
			executionReason: 'canonical-frontier-reserve',
			status: 'pending'
		});
		expect(second.executionDispositionAt?.getTime()).toBe(
			first.executionDispositionAt?.getTime()
		);
		await expect(
			repository.claimNextObject(['checkpoint-state'])
		).resolves.toBeNull();

		await dataSource.transaction(async (manager) => {
			await manager.query(
				`update "history_archive_object_queue"
				 set status = 'verified', "claimedAt" = null
				 where "remoteId" = $1`,
				[active[0]?.remoteId]
			);
			await manager.query(
				`update "history_archive_object_claim_slot"
				 set "objectRemoteId" = null, "claimedAt" = null
				 where "objectRemoteId" = $1`,
				[active[0]?.remoteId]
			);
		});
		await expect(
			repository.claimNextObject(['checkpoint-state'])
		).resolves.toMatchObject({
			checkpointLedger: forwardCheckpoint,
			status: 'scanning'
		});
	});

	async function expectPendingCheckpointToBeAdmittedAndClaimed(
		checkpointLedger: number
	): Promise<void> {
		const admissionCount = await admitCanonicalTargets(1, 1);
		const [reserved] = (await dataSource.query(
			`select status, "dependencyReady", "executionDisposition",
				"executionReason"
			 from "history_archive_object_queue"
			 where "objectType" = 'checkpoint-state'
				and "checkpointLedger" = $1`,
			[checkpointLedger]
		)) as readonly ReservedCheckpoint[];

		expect(admissionCount).toBe(1);
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
		)) as readonly Pick<ReservedCheckpoint, 'executionReason' | 'status'>[];
		expect(persistedClaim).toEqual({
			executionReason: 'canonical-frontier-reserve',
			status: 'scanning'
		});
	}

	async function seedPendingCheckpoint(
		checkpointLedger: number,
		index = 0,
		hostIdentity?: string
	): Promise<HistoryArchiveObject> {
		const root = createRoot(index);
		const checkpoint = createCheckpoint(index, checkpointLedger);
		if (hostIdentity !== undefined) {
			root.hostIdentity = hostIdentity;
			checkpoint.hostIdentity = hostIdentity;
		}
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
		return root;
	}

	async function admitCanonicalTargets(
		limit = 24,
		perHostLimit = 2
	): Promise<number> {
		const [admission] = (await dataSource.query(admitCanonicalFrontierSql, [
			limit,
			perHostLimit
		])) as readonly { readonly count: number }[];
		return admission?.count ?? 0;
	}

	async function readReservation(
		archiveUrlIdentity: string
	): Promise<ReservedCheckpoint> {
		const [reservation] = (await dataSource.query(
			`select status, "dependencyReady", "executionDisposition",
				"executionReason", "executionDispositionAt"
			 from "history_archive_object_queue"
			 where "archiveUrlIdentity" = $1 and "checkpointLedger" = $2`,
			[archiveUrlIdentity, forwardCheckpoint]
		)) as readonly ReservedCheckpoint[];
		if (reservation === undefined)
			throw new Error('Expected canonical reservation');
		return reservation;
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
			['00000000-0000-4000-8000-000000008101', networkHash(), checkpointLedger]
		);
	}
});

interface ReservedCheckpoint {
	readonly dependencyReady: boolean;
	readonly executionDisposition: string | null;
	readonly executionDispositionAt?: Date | null;
	readonly executionReason: string | null;
	readonly status: string;
}

function networkHash(): Buffer {
	return createHash('sha256').update(networkPassphrase, 'utf8').digest();
}
