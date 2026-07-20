import { mock, type MockProxy } from 'jest-mock-extended';
import { DataSource } from 'typeorm';
import { readHistoricalFullHistoryBackfillStatus } from '../HistoricalFullHistoryBackfillStatus.js';

describe('readHistoricalFullHistoryBackfillStatus', () => {
	let dataSource: MockProxy<DataSource>;

	beforeEach(() => {
		dataSource = mock<DataSource>();
	});

	it('reports the next adjacent checkpoint after a completed prepend', async () => {
		dataSource.query.mockResolvedValue([
			{
				completedCheckpoints: 182,
				completedJobs: 182,
				firstLedger: '63386176',
				jobState: null,
				leaseActive: null,
				latestErrorCode: null,
				proofCheckpointLedger: null,
				proofExpectedBucketCount: null,
				proofFailedBucketCount: null,
				proofFailureKind: null,
				proofStatus: null,
				proofVerifiedBucketCount: null,
				updatedAt: null
			}
		]);

		await expect(
			readHistoricalFullHistoryBackfillStatus(dataSource, 'Public network')
		).resolves.toEqual({
			completedCheckpoints: 182,
			completedJobs: 182,
			currentProof: null,
			failedJobs: 0,
			latestErrorCode: null,
			nextCheckpointLedger: '63386175',
			pendingJobs: 0,
			runningJobs: 0,
			state: 'idle',
			updatedAt: null
		});
		expect(dataSource.query).toHaveBeenCalledTimes(1);
	});

	it('reports completed progress and the best current proof blocker', async () => {
		dataSource.query.mockResolvedValue([
			{
				completedCheckpoints: '182',
				completedJobs: '182',
				firstLedger: '63374592',
				jobState: 'pending',
				leaseActive: null,
				latestErrorCode: 'proof-pending',
				proofCheckpointLedger: '63374591',
				proofExpectedBucketCount: 37,
				proofFailedBucketCount: 0,
				proofFailureKind: 'bucket-missing',
				proofStatus: 'not-evaluable',
				proofVerifiedBucketCount: 28,
				updatedAt: '2026-07-12T10:00:05.000Z'
			}
		]);

		const result = await readHistoricalFullHistoryBackfillStatus(
			dataSource,
			'Public network'
		);

		expect(result).toMatchObject({
			completedCheckpoints: 182,
			completedJobs: 182,
			currentProof: {
				checkpointLedger: '63374591',
				expectedBucketCount: 37,
				failedBucketCount: 0,
				failureKind: 'bucket-missing',
				remainingBucketCount: 9,
				status: 'not-evaluable',
				verifiedBucketCount: 28
			},
			failedJobs: 0,
			nextCheckpointLedger: '63374591',
			pendingJobs: 1,
			state: 'waiting-for-proof'
		});
	});

	it('reports only an unexpired lease as running', async () => {
		dataSource.query.mockResolvedValue([
			{
				completedCheckpoints: 1,
				completedJobs: 1,
				firstLedger: '63385472',
				jobState: 'leased',
				leaseActive: true,
				latestErrorCode: null,
				proofCheckpointLedger: null,
				proofExpectedBucketCount: null,
				proofFailedBucketCount: null,
				proofFailureKind: null,
				proofStatus: null,
				proofVerifiedBucketCount: null,
				updatedAt: '2026-07-12T10:00:05.000Z'
			}
		]);

		await expect(
			readHistoricalFullHistoryBackfillStatus(dataSource, 'Public network')
		).resolves.toMatchObject({
			pendingJobs: 0,
			runningJobs: 1,
			state: 'running'
		});
	});

	it('reports an expired lease as reclaimable queued work', async () => {
		dataSource.query.mockResolvedValue([
			{
				completedCheckpoints: 1,
				completedJobs: 1,
				firstLedger: '63385472',
				jobState: 'leased',
				leaseActive: false,
				latestErrorCode: null,
				proofCheckpointLedger: null,
				proofExpectedBucketCount: null,
				proofFailedBucketCount: null,
				proofFailureKind: null,
				proofStatus: null,
				proofVerifiedBucketCount: null,
				updatedAt: '2026-07-12T10:00:05.000Z'
			}
		]);

		await expect(
			readHistoricalFullHistoryBackfillStatus(dataSource, 'Public network')
		).resolves.toMatchObject({
			pendingJobs: 1,
			runningJobs: 0,
			state: 'queued'
		});
	});
});
