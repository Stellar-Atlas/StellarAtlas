import type { EntityManager } from 'typeorm';
import {
	findVerifiedHistoryArchiveBucketSources,
	getHistoryArchiveRepairPlanSummary,
	historyArchiveRepairPlanSummarySql,
	historyArchiveVerifiedBucketSourcesSql
} from '../HistoryArchiveRepairPlanQuery.js';

const bucketHash =
	'4eae73efaa0ce061441dfe43ffc61c0ed24fcbc59e5ee512d1b60e8da2509655';

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

	it('normalizes, deduplicates, and caps one batched source query', async () => {
		const query = jest.fn(async (): Promise<unknown[]> => [
			{
				archiveUrl: 'https://source.example',
				archiveUrlIdentity: 'https://source.example',
				bucketHash,
				objectUrl: `https://source.example/bucket-${bucketHash}.xdr.gz`,
				verifiedAt: '2026-07-07T18:00:00.000Z'
			}
		]);
		const manager = { query } as unknown as EntityManager;

		await expect(
			findVerifiedHistoryArchiveBucketSources(
				manager,
				[bucketHash.toUpperCase(), bucketHash, 'not-a-hash'],
				99
			)
		).resolves.toEqual([
			expect.objectContaining({
				archiveUrlIdentity: 'https://source.example',
				bucketHash,
				verifiedAt: new Date('2026-07-07T18:00:00.000Z')
			})
		]);
		expect(query).toHaveBeenCalledWith(historyArchiveVerifiedBucketSourcesSql, [
			[bucketHash],
			5
		]);
		expect(historyArchiveVerifiedBucketSourcesSql).toContain(
			'cross join lateral'
		);
		expect(historyArchiveVerifiedBucketSourcesSql).toContain(
			'limit $2::integer'
		);
		expect(historyArchiveVerifiedBucketSourcesSql).toContain(
			'\'{bucketObject,expectedBucketHash}\' = requested."bucketHash"'
		);
		expect(historyArchiveVerifiedBucketSourcesSql).toContain(
			'\'{bucketObject,sourceUrl}\' = archive_object."objectUrl"'
		);
		expect(historyArchiveVerifiedBucketSourcesSql).toContain(
			'\'{content,digest}\' = requested."bucketHash"'
		);
		expect(historyArchiveVerifiedBucketSourcesSql).toContain(
			"'{content,representation}' = 'uncompressed-xdr'"
		);
	});

	it('does not query PostgreSQL when no valid bucket hash is requested', async () => {
		const query = jest.fn(async (): Promise<unknown[]> => []);
		const manager = { query } as unknown as EntityManager;

		await expect(
			findVerifiedHistoryArchiveBucketSources(manager, ['invalid'], 5)
		).resolves.toEqual([]);
		expect(query).not.toHaveBeenCalled();
	});
});
