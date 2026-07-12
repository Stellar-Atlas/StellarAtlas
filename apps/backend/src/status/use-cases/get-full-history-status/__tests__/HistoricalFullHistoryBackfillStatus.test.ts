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
				firstLedger: '63386176',
				jobState: null,
				latestErrorCode: null,
				updatedAt: null
			}
		]);

		await expect(
			readHistoricalFullHistoryBackfillStatus(dataSource, 'Public network')
		).resolves.toEqual({
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

	it('reports proof waiting as active backfill state, not platform failure', async () => {
		dataSource.query.mockResolvedValue([
			{
				firstLedger: '63385472',
				jobState: 'pending',
				latestErrorCode: 'proof-pending',
				updatedAt: '2026-07-12T10:00:05.000Z'
			}
		]);

		const result = await readHistoricalFullHistoryBackfillStatus(
			dataSource,
			'Public network'
		);

		expect(result).toMatchObject({
			failedJobs: 0,
			nextCheckpointLedger: '63385471',
			pendingJobs: 1,
			state: 'waiting-for-proof'
		});
	});
});
