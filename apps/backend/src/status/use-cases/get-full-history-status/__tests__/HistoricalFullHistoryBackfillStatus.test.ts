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
				completedCheckpoints: '1',
				failedJobs: '0',
				firstLedger: '63386176',
				latestCompletedAt: '2026-07-12T09:48:02.715Z',
				latestErrorCode: null,
				pendingJobs: '0',
				runningJobs: '0',
				updatedAt: '2026-07-12T09:48:02.715Z'
			}
		]);

		await expect(
			readHistoricalFullHistoryBackfillStatus(dataSource, 'Public network')
		).resolves.toEqual({
			completedCheckpoints: 1,
			failedJobs: 0,
			latestCompletedAt: '2026-07-12T09:48:02.715Z',
			latestErrorCode: null,
			nextCheckpointLedger: '63386175',
			pendingJobs: 0,
			runningJobs: 0,
			state: 'idle',
			updatedAt: '2026-07-12T09:48:02.715Z'
		});
		expect(dataSource.query).toHaveBeenCalledTimes(1);
	});

	it('reports proof waiting as active backfill state, not platform failure', async () => {
		dataSource.query.mockResolvedValue([
			{
				completedCheckpoints: '12',
				failedJobs: '0',
				firstLedger: '63385472',
				latestCompletedAt: '2026-07-12T10:00:00.000Z',
				latestErrorCode: 'proof-pending',
				pendingJobs: '1',
				runningJobs: '0',
				updatedAt: '2026-07-12T10:00:05.000Z'
			}
		]);

		const result = await readHistoricalFullHistoryBackfillStatus(
			dataSource,
			'Public network'
		);

		expect(result).toMatchObject({
			completedCheckpoints: 12,
			failedJobs: 0,
			nextCheckpointLedger: '63385471',
			pendingJobs: 1,
			state: 'waiting-for-proof'
		});
	});
});
