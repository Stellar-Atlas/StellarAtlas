import { DataSource } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import { HistoryArchiveCheckpointProof } from '../../../../domain/history-archive-checkpoint-proof/HistoryArchiveCheckpointProof.js';
import { HistoryArchiveObject } from '../../../../domain/history-archive-object/HistoryArchiveObject.js';
import { HistoryArchiveStateSnapshot } from '../../../../domain/history-archive-state/HistoryArchiveStateSnapshot.js';
import {
	materializeCompactCheckpointPlans,
	materializeNextCompactCheckpointPlan
} from '../HistoryArchiveCompactPlanning.js';
import { TypeOrmHistoryArchiveStateRepository } from '../TypeOrmHistoryArchiveStateRepository.js';
import { createCanonicalFrontierTestSchema } from './HistoryArchiveCanonicalFrontierTestSchema.js';
import {
	createBucketMissingProof,
	createRoot
} from './HistoryArchiveObjectExecutionTestFixtures.js';

jest.setTimeout(60_000);

describe('historical admission uses the last successful same-source snapshot', () => {
	let dataSource: DataSource;
	let postgres: DisposablePostgres;
	let states: TypeOrmHistoryArchiveStateRepository;

	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		dataSource = new DataSource({
			type: 'postgres',
			url: postgres.url,
			synchronize: true,
			entities: [
				HistoryArchiveCheckpointProof,
				HistoryArchiveObject,
				HistoryArchiveStateSnapshot
			]
		});
		await dataSource.initialize();
		await createCanonicalFrontierTestSchema(dataSource);
		states = new TypeOrmHistoryArchiveStateRepository(
			dataSource.getRepository(HistoryArchiveStateSnapshot)
		);
	});

	beforeEach(async () => {
		await dataSource.query(`
			truncate history_archive_object_queue, history_archive_checkpoint_proof,
				history_archive_state_snapshot, history_archive_checkpoint_scan_cursor cascade
		`);
	});

	afterAll(async () => {
		if (dataSource?.isInitialized) await dataSource.destroy();
		if (postgres !== undefined) await postgres.stop();
	});

	for (const path of ['completion', 'recovery'] as const) {
		it.each(['pending', 'scanning', 'failed'] as const)(
			path +
				': admits historical work during a %s root refresh without clearing failures',
			async (status) => {
				const root = await seed(status, 'available', 191);
				const before = await dataSource
					.getRepository(HistoryArchiveObject)
					.findOneByOrFail({
						remoteId: root.remoteId
					});
				const snapshotBefore = await states.findByUrl(root.archiveUrl);
				const planned = await plan(path, root);
				await plan(path, root);
				const checkpoints = await plannedCheckpoints(root);
				expect(planned).toBeGreaterThan(0);
				expect(checkpoints).toContain(127);
				expect(
					checkpoints.every((ledger) => ledger >= 63 && ledger <= 191)
				).toBe(true);
				expect(
					await dataSource.getRepository(HistoryArchiveObject).findOneByOrFail({
						remoteId: root.remoteId
					})
				).toEqual(before);
				const snapshotAfter = await states.findByUrl(root.archiveUrl);
				expect(snapshotAfter).toEqual(snapshotBefore);
				expect(snapshotAfter).toMatchObject({
					status: 'available',
					currentLedger: 191,
					latestFailureType: 'archive_transport_error',
					latestFailureMessage: 'root refresh timeout'
				});
				const [cursor] = await dataSource.query(
					`
					select "latestCheckpointLedger" from history_archive_checkpoint_scan_cursor
					where "archiveUrlIdentity" = $1
				`,
					[root.archiveUrlIdentity]
				);
				// Historical high-water metadata is retained, not trusted as a new admission bound.
				expect(cursor.latestCheckpointLedger).toBe(959);
			}
		);

		it.each([
			'absent',
			'failed-only',
			'above-head',
			'incomplete-checkpoint',
			'wrong-root-url'
		] as const)(path + ': rejects %s range authority', async (scenario) => {
			const root = await seed(
				'pending',
				scenario === 'absent' || scenario === 'failed-only'
					? scenario
					: 'available',
				scenario === 'above-head'
					? 63
					: scenario === 'incomplete-checkpoint'
						? 126
						: 191
			);
			if (scenario === 'wrong-root-url') {
				await dataSource
					.getRepository(HistoryArchiveObject)
					.update(
						{ remoteId: root.remoteId },
						{ archiveUrl: root.archiveUrl + '/other' }
					);
			}
			expect(await plan(path, root)).toBe(0);
			expect(await plannedCheckpoints(root)).toEqual([]);
		});
	}

	async function seed(
		status: HistoryArchiveObject['status'],
		snapshot: 'available' | 'absent' | 'failed-only',
		currentLedger: number
	): Promise<HistoryArchiveObject> {
		const root = createRoot(40);
		await dataSource.getRepository(HistoryArchiveObject).save(root);
		if (snapshot === 'available') {
			await states.saveAvailable(
				root.archiveUrl,
				{
					observedAt: '2026-09-06T01:00:00.000Z',
					stellarHistoryUrl:
						root.archiveUrl + '/.well-known/stellar-history.json',
					stellarHistory: {
						currentBuckets: [],
						currentLedger,
						server: 'test',
						version: 1,
						networkPassphrase: 'snapshot-test-network'
					}
				},
				'history-scanner'
			);
		}
		if (snapshot !== 'absent') {
			await states.saveFailure({
				archiveUrl: root.archiveUrl,
				stateUrl: root.archiveUrl + '/.well-known/stellar-history.json',
				status: 'unreachable',
				source: 'history-scanner',
				observedAt: new Date('2026-09-06T02:00:00.000Z'),
				errorType: 'archive_transport_error',
				errorMessage: 'root refresh timeout'
			});
		}
		await dataSource.getRepository(HistoryArchiveObject).update(
			{ remoteId: root.remoteId },
			{
				status,
				attempts: 7,
				errorType: 'archive_transport_error',
				errorMessage: 'root refresh timeout',
				failureChannel: 'archive_availability'
			}
		);
		await dataSource.query(
			`
			insert into history_archive_checkpoint_scan_cursor (
				"archiveUrlIdentity", "latestCheckpointLedger",
				"lastForwardCheckpointLedger", "nextHistoricalCheckpointLedger"
			) values ($1, 959, 63, 127)
		`,
			[root.archiveUrlIdentity]
		);
		const predecessor = createBucketMissingProof(root.archiveUrlIdentity, 63);
		predecessor.status = 'verified';
		predecessor.bucketsVerified = true;
		predecessor.verifiedBucketCount = 1;
		predecessor.missingBucketCount = 0;
		predecessor.failureKind = null;
		await dataSource
			.getRepository(HistoryArchiveCheckpointProof)
			.save(predecessor);
		return root;
	}

	async function plan(
		path: 'completion' | 'recovery',
		root: HistoryArchiveObject
	): Promise<number> {
		return path === 'completion'
			? materializeNextCompactCheckpointPlan(
					dataSource.manager,
					root.archiveUrlIdentity,
					63
				)
			: materializeCompactCheckpointPlans(dataSource.manager, [
					root.archiveUrlIdentity
				]);
	}

	async function plannedCheckpoints(
		root: HistoryArchiveObject
	): Promise<number[]> {
		const rows = await dataSource.query<
			readonly { checkpointLedger: number }[]
		>(
			`
			select "checkpointLedger" from history_archive_object_queue
			where "archiveUrlIdentity" = $1 and "objectType" = 'checkpoint-state'
			order by "checkpointLedger"
		`,
			[root.archiveUrlIdentity]
		);
		return rows.map((row) => row.checkpointLedger);
	}
});
