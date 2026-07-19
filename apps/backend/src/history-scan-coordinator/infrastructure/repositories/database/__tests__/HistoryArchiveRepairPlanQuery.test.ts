import type { EntityManager } from 'typeorm';
import {
	getHistoryArchiveRepairPlanSummary,
	historyArchiveRepairPlanSummarySql
} from '../HistoryArchiveRepairPlanQuery.js';

describe('HistoryArchiveRepairPlanQuery', () => {
	it('reads exact repair counts from completed rollups without touching the object queue', async () => {
		const query = jest.fn(async (sql: string): Promise<unknown[]> => {
			if (sql.includes('history_archive_object_host_throttle')) return [];
			return [
				{
					activeObjects: '1',
					failedCheckpointProofs: '4',
					objectRollupComplete: true,
					pendingObjects: '3',
					proofRollupComplete: true,
					totalObjects: '11',
					verifiedObjects: '5'
				}
			];
		});
		const manager = { query } as unknown as EntityManager;

		await expect(
			getHistoryArchiveRepairPlanSummary(manager, 'https://history.example')
		).resolves.toEqual({
			activeObjects: 1,
			failedCheckpointProofs: 4,
			failedObjects: 2,
			hostThrottles: [],
			pendingObjects: 3,
			verifiedObjects: 5
		});
		expect(historyArchiveRepairPlanSummarySql).not.toContain(
			'history_archive_object_queue'
		);
		expect(query).toHaveBeenCalledTimes(2);
	});

	it('fails closed when either evidence rollup is incomplete', async () => {
		const query = jest.fn(async (sql: string): Promise<unknown[]> => {
			if (sql.includes('history_archive_object_host_throttle')) return [];
			return [
				{
					activeObjects: 0,
					failedCheckpointProofs: 0,
					objectRollupComplete: false,
					pendingObjects: 0,
					proofRollupComplete: true,
					totalObjects: 0,
					verifiedObjects: 0
				}
			];
		});
		const manager = { query } as unknown as EntityManager;

		await expect(
			getHistoryArchiveRepairPlanSummary(manager, 'https://history.example')
		).rejects.toThrow('Archive repair plan evidence rollups are not ready');
	});
});
