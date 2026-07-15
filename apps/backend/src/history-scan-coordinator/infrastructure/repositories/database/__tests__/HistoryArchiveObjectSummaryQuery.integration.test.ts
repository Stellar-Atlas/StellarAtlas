import { DataSource } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import { getHistoryArchiveObjectSummary } from '../HistoryArchiveObjectSummaryQuery.js';
import { HistoryArchiveObjectTypeSummaryUnavailableError } from '../HistoryArchiveObjectTypeSummaryReadQuery.js';
import {
	archiveObjectBucketHashIndexName,
	archiveObjectGlobalBucketHashIndexName,
	HistoryArchiveUniqueBucketHashSummaryUnavailableError
} from '../HistoryArchiveObjectBucketSummaryQuery.js';
import {
	archiveA,
	archiveB,
	bucketHashB,
	resetObjectSummaryFixture
} from './HistoryArchiveObjectSummaryQueryFixture.js';

jest.setTimeout(120_000);

describe('HistoryArchiveObjectSummaryQuery with PostgreSQL', () => {
	let dataSource: DataSource;
	let postgres: DisposablePostgres;

	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		dataSource = new DataSource({ type: 'postgres', url: postgres.url });
		await dataSource.initialize();
	});

	beforeEach(async () => {
		await resetObjectSummaryFixture(dataSource);
	});

	afterAll(async () => {
		if (dataSource?.isInitialized) await dataSource.destroy();
		if (postgres !== undefined) await postgres.stop();
	});

	it('returns exact global rollup counts and cross-archive unique hashes', async () => {
		const summary = await getHistoryArchiveObjectSummary(dataSource.manager, {
			generatedAt: new Date('2026-07-15T12:00:00.000Z')
		});

		expect(summary).toMatchObject({
			activeObjects: 1,
			archiveUrl: null,
			archiveUrlIdentity: null,
			buckets: {
				activeBucketObjects: 0,
				failedBucketObjects: 1,
				pendingBucketObjects: 1,
				totalBucketObjects: 3,
				uniqueBucketHashes: 2,
				verifiedBucketObjects: 1
			},
			failedObjects: 4,
			generatedAt: '2026-07-15T12:00:00.000Z',
			pendingObjects: 2,
			scope: 'global',
			totalObjects: 10,
			verifiedObjects: 3
		});
		expect(summary.objectTypes).toEqual([
			objectType('history-archive-state', 2, 0, 0, 1, 1),
			objectType('ledger', 3, 1, 0, 1, 1),
			objectType('transactions', 1, 0, 1, 0, 0),
			objectType('results', 1, 0, 0, 0, 1),
			objectType('bucket', 3, 1, 0, 1, 1)
		]);
		expect(summary.sources).toEqual([
			{
				activeObjects: 1,
				archiveUrl: archiveA,
				archiveUrlIdentity: archiveA,
				currentLedger: 127,
				failedObjects: 2,
				latestCheckpointLedger: 127,
				latestDiscoveredCheckpointLedger: 127,
				objectCompleteCheckpoints: 1,
				observedAt: '2026-07-15T10:00:00.000Z',
				pendingObjects: 0,
				rootObjectStatus: 'verified',
				source: 'network-scan',
				stateStatus: 'available',
				stateUrl: `${archiveA}/.well-known/stellar-history.json`,
				totalObjects: 6,
				verifiedCheckpoints: 1,
				verifiedObjects: 3
			},
			{
				activeObjects: 0,
				archiveUrl: archiveB,
				archiveUrlIdentity: archiveB,
				currentLedger: 63,
				failedObjects: 2,
				latestCheckpointLedger: 63,
				latestDiscoveredCheckpointLedger: 63,
				objectCompleteCheckpoints: 1,
				observedAt: '2026-07-15T09:00:00.000Z',
				pendingObjects: 2,
				rootObjectStatus: 'failed',
				source: 'history-scanner',
				stateStatus: 'available',
				stateUrl: `${archiveB}/.well-known/stellar-history.json`,
				totalObjects: 4,
				verifiedCheckpoints: 0,
				verifiedObjects: 0
			}
		]);
		expect(summary.checkpoints).toEqual({
			activeArchiveCheckpoints: 1,
			archiveRootsWithState: 2,
			categoryConsistencyFailedCheckpoints: 1,
			categoryConsistencyNotEvaluatedCheckpoints: 0,
			categoryConsistencyPendingCheckpoints: 1,
			categoryConsistentArchiveCheckpoints: 1,
			completeArchiveCheckpoints: 2,
			discoveryCompleteArchiveRoots: 2,
			expectedArchiveCheckpoints: 3,
			failedArchiveCheckpoints: 1,
			latestCheckpointLedger: 127,
			missingArchiveCheckpoints: 0,
			objectCompleteArchiveCheckpoints: 2,
			oldestCheckpointLedger: 63,
			partialArchiveCheckpoints: 1,
			totalArchiveCheckpoints: 3
		});
	});

	it('returns exact archive counts and follows trigger-maintained changes', async () => {
		await dataSource.query(
			`update history_archive_object_queue
			 set status = 'verified', "failureChannel" = null
			 where "archiveUrlIdentity" = $1 and "bucketHash" = $2`,
			[archiveA, bucketHashB]
		);

		const summary = await getHistoryArchiveObjectSummary(dataSource.manager, {
			archiveUrl: archiveA,
			archiveUrlIdentity: archiveA
		});

		expect(summary).toMatchObject({
			activeObjects: 1,
			archiveUrl: archiveA,
			archiveUrlIdentity: archiveA,
			buckets: {
				failedBucketObjects: 0,
				totalBucketObjects: 2,
				uniqueBucketHashes: 2,
				verifiedBucketObjects: 2
			},
			failedObjects: 1,
			pendingObjects: 0,
			scope: 'archive',
			totalObjects: 6,
			verifiedObjects: 4
		});
		expect(summary.sources).toHaveLength(1);
	});

	it('returns real zeroes after a completed queue truncate', async () => {
		await dataSource.query('truncate history_archive_object_queue');

		const summary = await getHistoryArchiveObjectSummary(dataSource.manager);

		expect(summary).toMatchObject({
			activeObjects: 0,
			buckets: { totalBucketObjects: 0, uniqueBucketHashes: 0 },
			failedObjects: 0,
			objectTypes: [],
			pendingObjects: 0,
			totalObjects: 0,
			verifiedObjects: 0
		});
		expect(summary.sources).toHaveLength(2);
		expect(
			summary.sources.every(
				(source) =>
					source.totalObjects === 0 && source.rootObjectStatus === null
			)
		).toBe(true);
	});

	it('fails instead of returning zeroes while the rollup is incomplete', async () => {
		await dataSource.query('truncate history_archive_object_type_summary');
		await dataSource.query(`
			update history_archive_object_type_summary_progress
			set "complete" = false, "completedAt" = null
			where id = 1
		`);

		await expectUnavailable('incomplete');
	});

	it('requires completedAt even when complete is true', async () => {
		await dataSource.query(`
			alter table history_archive_object_type_summary_progress
			drop constraint "CHK_history_archive_object_type_summary_progress_complete"
		`);
		await dataSource.query(`
			update history_archive_object_type_summary_progress
			set "complete" = true, "completedAt" = null
			where id = 1
		`);

		await expectUnavailable('incomplete');
	});

	it('requires the progress cursor to equal its cutoff', async () => {
		await dataSource.query(`
			update history_archive_object_type_summary_progress
			set "complete" = true, "completedAt" = now(),
				"lastObjectId" = "cutoffObjectId" - 1
			where id = 1
		`);

		await expectUnavailable('incomplete');
	});

	it('fails explicitly when the rollup progress row is unavailable', async () => {
		await dataSource.query(
			'drop table history_archive_object_type_summary_progress'
		);

		await expectUnavailable('unavailable');
	});

	it('fails before global counting when its hash index is unavailable', async () => {
		await dataSource.query(
			`drop index "${archiveObjectGlobalBucketHashIndexName}"`
		);

		await expect(
			getHistoryArchiveObjectSummary(dataSource.manager)
		).rejects.toBeInstanceOf(
			HistoryArchiveUniqueBucketHashSummaryUnavailableError
		);
	});

	it('fails before archive counting when its source index is unavailable', async () => {
		await dataSource.query(`drop index "${archiveObjectBucketHashIndexName}"`);

		await expect(
			getHistoryArchiveObjectSummary(dataSource.manager, {
				archiveUrl: archiveA,
				archiveUrlIdentity: archiveA
			})
		).rejects.toBeInstanceOf(
			HistoryArchiveUniqueBucketHashSummaryUnavailableError
		);
	});

	it('fails when rollup evidence violates the single-root invariant', async () => {
		await dataSource.query(
			`insert into history_archive_object_queue (
				"archiveUrlIdentity", "objectType", "objectKey", status,
				"executionDisposition", "dependencyReady"
			) values ($1, 'history-archive-state', 'root:duplicate', 'pending',
				'executable', true)`,
			[archiveA]
		);

		await expect(
			getHistoryArchiveObjectSummary(dataSource.manager)
		).rejects.toThrow('exactly one root object');
	});

	async function expectUnavailable(
		reason: 'incomplete' | 'unavailable'
	): Promise<void> {
		await expect(
			getHistoryArchiveObjectSummary(dataSource.manager)
		).rejects.toEqual(
			expect.objectContaining({
				message: `Archive object type summary rollup is ${reason}`,
				name: 'HistoryArchiveObjectTypeSummaryUnavailableError'
			})
		);
		await expect(
			getHistoryArchiveObjectSummary(dataSource.manager)
		).rejects.toBeInstanceOf(HistoryArchiveObjectTypeSummaryUnavailableError);
	}
});

function objectType(
	objectTypeValue:
		'history-archive-state' | 'ledger' | 'transactions' | 'results' | 'bucket',
	totalObjects: number,
	pendingObjects: number,
	activeObjects: number,
	verifiedObjects: number,
	failedObjects: number
) {
	return {
		activeObjects,
		failedObjects,
		objectType: objectTypeValue,
		pendingObjects,
		totalObjects,
		verifiedObjects
	};
}
