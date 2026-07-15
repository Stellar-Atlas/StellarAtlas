import { createHash } from 'node:crypto';
import { DataSource } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import { HistoryArchiveCheckpointProof } from '../../../../domain/history-archive-checkpoint-proof/HistoryArchiveCheckpointProof.js';
import { HistoryArchiveObject } from '../../../../domain/history-archive-object/HistoryArchiveObject.js';
import { HistoryArchiveObjectEventMigration1784370000000 } from '../../../database/migrations/1784370000000-HistoryArchiveObjectEventMigration.js';
import { HistoryArchiveObjectHostThrottleMigration1784410000000 } from '../../../database/migrations/1784410000000-HistoryArchiveObjectHostThrottleMigration.js';
import { HistoryArchiveObjectClaimCursorMigration1784780000000 } from '../../../database/migrations/1784780000000-HistoryArchiveObjectClaimCursorMigration.js';
import {
	admitCanonicalFrontierSql,
	materializeCanonicalFrontierDependenciesSql
} from '../HistoryArchiveCanonicalFrontierSql.js';
import { createCanonicalFrontierTestSchema } from './HistoryArchiveCanonicalFrontierTestSchema.js';
import {
	createCanonicalCheckpointFacts,
	createCanonicalObject as object
} from './HistoryArchiveObjectExecutionTestFixtures.js';

const networkPassphrase = 'Historical predecessor repair fixture';
const unrelatedNetworkPassphrase = 'Unrelated predecessor fixture';
const targetCheckpoint = 63_384_895;
const predecessorCheckpoint = targetCheckpoint - 64;
const forwardCheckpoint = targetCheckpoint + 64;
const unrelatedCheckpoint = predecessorCheckpoint - 64;
const targetRootCount = 4;
const bucketHash = 'ab'.repeat(32);
const predecessorKey = checkpointKey(predecessorCheckpoint);
jest.setTimeout(60_000);

describe('canonical immediate predecessor checkpoint frontier', () => {
	let dataSource: DataSource;
	let postgres: DisposablePostgres;
	let parkedRemoteIds: ReadonlyMap<string, string>;

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
	});

	beforeEach(async () => {
		await dataSource.query(
			'truncate "history_archive_checkpoint_proof", "history_archive_object_event", "history_archive_object_queue", "history_archive_object_frontier_cursor", "history_archive_checkpoint_bucket_dependency", "history_archive_state_snapshot", "full_history_historical_backfill_job", "full_history_watermark", "full_history_promotion_runtime" restart identity cascade'
		);
		parkedRemoteIds = await seedProductionShape();
	});

	afterAll(async () => {
		if (dataSource?.isInitialized) await dataSource.destroy();
		if (postgres !== undefined) await postgres.stop();
	});

	it('preserves parked predecessor evidence and materializes the missing root', async () => {
		await dataSource.query(materializeCanonicalFrontierDependenciesSql);

		const predecessors = await readTargetPredecessors();

		expect(predecessors).toHaveLength(targetRootCount);
		for (const row of predecessors.slice(0, 3)) {
			expect(row).toMatchObject({
				attempts: 2,
				dependencyReady: true,
				errorMessage: 'Remote history object returned HTTP 404',
				errorType: 'http-status',
				executionDisposition: null,
				executionReason: null,
				failureChannel: 'archive_evidence',
				httpStatus: 404,
				remoteId: parkedRemoteIds.get(row.archiveUrlIdentity),
				status: 'pending'
			});
		}

		const inserted = predecessors[3];
		expect(inserted).toMatchObject({
			attempts: 0,
			dependencyReady: true,
			errorMessage: null,
			errorType: null,
			executionDisposition: 'deferred',
			executionReason: 'canonical-frontier-materialization',
			failureChannel: null,
			httpStatus: null,
			objectOrder: 10,
			status: 'pending'
		});
		expect(inserted?.objectUrl).toBe(
			`${archiveUrl(3)}/history/03/c7/2c/history-03c72cff.json`
		);
		expect(await countTargetPredecessorLedgers()).toBe(0);
	});

	it('reserves pending predecessor checkpoints before category proof work', async () => {
		await dataSource.query(materializeCanonicalFrontierDependenciesSql);

		const [admission] = await dataSource.query<AdmissionRow[]>(
			admitCanonicalFrontierSql,
			[targetRootCount, 1]
		);
		const reserved = await readCanonicalReservations();
		const categoryReservations = await dataSource.query<CountRow[]>(`
			select count(*)::integer as count
			from "history_archive_object_queue"
			where "executionReason" = 'canonical-frontier-reserve'
				and "objectType" <> 'checkpoint-state'
		`);
		const perRoot = await dataSource.query<CountRow[]>(`
			select count(*)::integer as count
			from "history_archive_object_queue"
			where "executionReason" = 'canonical-frontier-reserve'
			group by "archiveUrlIdentity"
		`);

		expect(admission?.count).toBe(targetRootCount);
		expect(reserved).toHaveLength(targetRootCount);
		expect(
			reserved.every(
				(row) =>
					row.checkpointLedger === predecessorCheckpoint &&
					row.objectKey === predecessorKey &&
					row.objectType === 'checkpoint-state'
			)
		).toBe(true);
		expect(categoryReservations[0]?.count).toBe(0);
		expect(perRoot.every((row) => row.count === 1)).toBe(true);
		const admittedPredecessors = await readTargetPredecessors();
		expect(
			admittedPredecessors
				.slice(0, 3)
				.every(
					(row) =>
						row.errorType === 'http-status' &&
						row.failureChannel === 'archive_evidence' &&
						row.httpStatus === 404
				)
		).toBe(true);
	});

	it('keeps predecessor admission available without a same-root historical target', async () => {
		await dataSource.query(
			`delete from "history_archive_object_queue"
			 where "archiveUrlIdentity" = $1 and "objectKey" = $2`,
			[archiveUrl(0), checkpointKey(targetCheckpoint)]
		);
		const forward = object(
			0,
			'checkpoint-state',
			checkpointKey(forwardCheckpoint),
			forwardCheckpoint,
			'verified'
		);
		forward.verificationFacts = createCanonicalCheckpointFacts(
			bucketHash,
			forward.objectUrl,
			forwardCheckpoint
		);
		await dataSource.getRepository(HistoryArchiveObject).save(forward);
		await seedForwardTarget();

		await dataSource.query(materializeCanonicalFrontierDependenciesSql);
		const [admission] = await dataSource.query<AdmissionRow[]>(
			admitCanonicalFrontierSql,
			[targetRootCount, 1]
		);
		const reserved = await readCanonicalReservations();
		const forwardRootReservation = reserved.find(
			(row) => row.archiveUrlIdentity === archiveUrl(0)
		);

		expect(admission?.count).toBe(targetRootCount);
		expect(reserved).toHaveLength(targetRootCount);
		expect(new Set(reserved.map((row) => row.archiveUrlIdentity)).size).toBe(
			targetRootCount
		);
		expect(forwardRootReservation).toMatchObject({
			checkpointLedger: targetCheckpoint,
			objectKey: checkpointKey(targetCheckpoint),
			objectType: 'checkpoint-state'
		});
		expect(
			reserved
				.filter((row) => row.archiveUrlIdentity !== archiveUrl(0))
				.every((row) => row.checkpointLedger === predecessorCheckpoint)
		).toBe(true);
	});

	it('is idempotent across repeated materialization and admission', async () => {
		await dataSource.query(materializeCanonicalFrontierDependenciesSql);
		const firstRows = await readTargetPredecessors();
		await dataSource.query(materializeCanonicalFrontierDependenciesSql);
		const secondRows = await readTargetPredecessors();

		const [firstAdmission] = await dataSource.query<AdmissionRow[]>(
			admitCanonicalFrontierSql,
			[targetRootCount, 1]
		);
		const [secondAdmission] = await dataSource.query<AdmissionRow[]>(
			admitCanonicalFrontierSql,
			[targetRootCount, 1]
		);

		expect(secondRows).toHaveLength(targetRootCount);
		expect(secondRows.map((row) => row.remoteId)).toEqual(
			firstRows.map((row) => row.remoteId)
		);
		expect(firstAdmission?.count).toBe(targetRootCount);
		expect(secondAdmission?.count).toBe(0);
		expect(await readCanonicalReservations()).toHaveLength(targetRootCount);
	});

	it('does not admit older same-root or other-network backlog', async () => {
		await dataSource.query(materializeCanonicalFrontierDependenciesSql);
		await dataSource.query(admitCanonicalFrontierSql, [
			targetRootCount,
			1
		]);

		const unrelated = await dataSource.query<UnrelatedRow[]>(
			`select "archiveUrlIdentity", "checkpointLedger",
				"executionDisposition", "executionReason"
			 from "history_archive_object_queue"
			 where "objectType" = 'checkpoint-state'
				and (
					(
						"archiveUrlIdentity" = any($1::text[])
						and "checkpointLedger" = $2
					)
					or (
						"archiveUrlIdentity" = $3
						and "objectKey" = $4
					)
				)
			 order by "archiveUrlIdentity", "checkpointLedger"`,
			[targetArchiveUrls(), unrelatedCheckpoint, archiveUrl(99), predecessorKey]
		);
		const reserved = await readCanonicalReservations();

		expect(unrelated).toHaveLength(targetRootCount + 1);
		expect(
			unrelated.every(
				(row) =>
					row.executionDisposition === null && row.executionReason === null
			)
		).toBe(true);
		expect(
			reserved.every((row) => row.archiveUrlIdentity !== archiveUrl(99))
		).toBe(true);
	});

	async function seedProductionShape(): Promise<ReadonlyMap<string, string>> {
		const remoteIds = new Map<string, string>();
		for (let index = 0; index < targetRootCount; index += 1) {
			const parked = await seedArchive(index, networkPassphrase, index < 3);
			if (parked !== null) remoteIds.set(archiveUrl(index), parked.remoteId);
		}
		await seedArchive(99, unrelatedNetworkPassphrase, true);
		await seedHistoricalTarget();
		return remoteIds;
	}

	async function seedArchive(
		index: number,
		archiveNetworkPassphrase: string,
		includePredecessor: boolean
	): Promise<HistoryArchiveObject | null> {
		const root = object(
			index,
			'history-archive-state',
			'root',
			null,
			'verified'
		);
		const target = object(
			index,
			'checkpoint-state',
			checkpointKey(targetCheckpoint),
			targetCheckpoint,
			'verified'
		);
		target.verificationFacts = createCanonicalCheckpointFacts(
			bucketHash,
			target.objectUrl,
			targetCheckpoint
		);
		const older = object(
			index,
			'checkpoint-state',
			checkpointKey(unrelatedCheckpoint),
			unrelatedCheckpoint
		);
		older.dependencyReady = true;
		older.executionDisposition = null;
		older.executionReason = null;

		let predecessor: HistoryArchiveObject | null = null;
		if (includePredecessor) {
			predecessor = object(
				index,
				'checkpoint-state',
				predecessorKey,
				predecessorCheckpoint
			);
			predecessor.dependencyReady = true;
			predecessor.executionDisposition = null;
			predecessor.executionReason = null;
			predecessor.attempts = 2;
			predecessor.errorType = 'http-status';
			predecessor.failureChannel = 'archive_evidence';
			predecessor.errorMessage = 'Remote history object returned HTTP 404';
			predecessor.httpStatus = 404;
		}

		await dataSource
			.getRepository(HistoryArchiveObject)
			.save(
				predecessor === null
					? [root, target, older]
					: [root, target, older, predecessor]
			);
		await dataSource.query(
			`insert into "history_archive_state_snapshot" (
				"archiveUrlIdentity", status, "networkPassphrase"
			 ) values ($1, 'available', $2)`,
			[archiveUrl(index), archiveNetworkPassphrase]
		);
		return predecessor;
	}

	async function seedHistoricalTarget(): Promise<void> {
		const networkHash = createHash('sha256')
			.update(networkPassphrase, 'utf8')
			.digest();
		await dataSource.query(
			`insert into "full_history_watermark" (
				"network_passphrase_hash", "first_ledger"
			 ) values ($1, $2)`,
			[networkHash, targetCheckpoint + 1]
		);
		await dataSource.query(
			`insert into "full_history_historical_backfill_job" (
				id, "network_passphrase_hash", "first_checkpoint_ledger",
				"last_checkpoint_ledger", state
			 ) values ($1, $2, $3, $3, 'pending')`,
			['00000000-0000-4000-8000-000000008002', networkHash, targetCheckpoint]
		);
	}

	async function seedForwardTarget(): Promise<void> {
		const networkHash = createHash('sha256')
			.update(networkPassphrase, 'utf8')
			.digest();
		await dataSource.query(
			`insert into "full_history_promotion_runtime" (
				"network_passphrase_hash", state, "checkpoint_ledger"
			 ) values ($1, 'waiting-for-proof', $2)`,
			[networkHash, forwardCheckpoint]
		);
	}

	async function readTargetPredecessors(): Promise<PredecessorRow[]> {
		return dataSource.query<PredecessorRow[]>(
			`select "archiveUrlIdentity", "remoteId", status, attempts,
				"objectOrder", "objectUrl", "dependencyReady",
				"executionDisposition", "executionReason", "errorType",
				"failureChannel", "errorMessage", "httpStatus"
			 from "history_archive_object_queue"
			 where "archiveUrlIdentity" = any($1::text[])
				and "objectType" = 'checkpoint-state'
				and "objectKey" = $2
			 order by "archiveUrlIdentity"`,
			[targetArchiveUrls(), predecessorKey]
		);
	}

	async function readCanonicalReservations(): Promise<ReservationRow[]> {
		return dataSource.query<ReservationRow[]>(`
			select "archiveUrlIdentity", "objectType", "objectKey",
				"checkpointLedger"
			from "history_archive_object_queue"
			where "executionReason" = 'canonical-frontier-reserve'
			order by "archiveUrlIdentity"
		`);
	}

	async function countTargetPredecessorLedgers(): Promise<number> {
		const [row] = await dataSource.query<CountRow[]>(
			`select count(*)::integer as count
			 from "history_archive_object_queue"
			 where "archiveUrlIdentity" = any($1::text[])
				and "objectType" = 'ledger'
				and "checkpointLedger" = $2`,
			[targetArchiveUrls(), predecessorCheckpoint]
		);
		return row?.count ?? 0;
	}
});

interface AdmissionRow {
	readonly count: number;
}

interface CountRow {
	readonly count: number;
}

interface PredecessorRow {
	readonly archiveUrlIdentity: string;
	readonly attempts: number;
	readonly dependencyReady: boolean;
	readonly errorMessage: string | null;
	readonly errorType: string | null;
	readonly executionDisposition: string | null;
	readonly executionReason: string | null;
	readonly failureChannel: string | null;
	readonly httpStatus: number | null;
	readonly objectOrder: number;
	readonly objectUrl: string;
	readonly remoteId: string;
	readonly status: string;
}

interface ReservationRow {
	readonly archiveUrlIdentity: string;
	readonly checkpointLedger: number;
	readonly objectKey: string;
	readonly objectType: string;
}

interface UnrelatedRow {
	readonly archiveUrlIdentity: string;
	readonly checkpointLedger: number;
	readonly executionDisposition: string | null;
	readonly executionReason: string | null;
}

function archiveUrl(index: number): string {
	return `https://canonical-${index}.example/history`;
}

function checkpointKey(checkpointLedger: number): string {
	return `checkpoint-state:${checkpointLedger.toString(16).padStart(8, '0')}`;
}

function targetArchiveUrls(): readonly string[] {
	return Array.from({ length: targetRootCount }, (_, index) =>
		archiveUrl(index)
	);
}
