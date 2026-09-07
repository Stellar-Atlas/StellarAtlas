import { jest } from '@jest/globals';
import type { EntityManager } from 'typeorm';
import type { HistoryArchiveStatusSourceV1 } from 'shared';
import {
	attachArchiveScanCoverage,
	archiveScanCoverageSummarySql
} from '../HistoryArchiveScanCoverageReadModel.js';
const source = {
	archiveUrlIdentity: 'https://case.example/UPPER',
	durableVerifiedCheckpointProofs: 4
} as HistoryArchiveStatusSourceV1;
function fixture() {
	const query = jest.fn<(...args: unknown[]) => Promise<unknown[]>>();
	return {
		query,
		manager: { connection: {}, query } as unknown as EntityManager
	};
}
describe('compact scan coverage summary', () => {
	it('reads only compact root counters and four-row readiness, never raw queues or events', async () => {
		const { query, manager } = fixture();
		query.mockResolvedValueOnce([{ ready: true }]).mockResolvedValue([
			{
				archiveUrlIdentity: source.archiveUrlIdentity,
				checkedCheckpointPositions: '5',
				listingCoveredCheckpointPositions: '4',
				scannedCheckpointPositions: '7',
				complete: false,
				updatedAt: '2026-09-07T00:00:00Z'
			}
		]);
		const [row] = await attachArchiveScanCoverage(manager, [source]);
		expect(row?.scanCoverage).toEqual({
			checkedCheckpointPositions: 5,
			listingCoveredCheckpointPositions: 4,
			scannedCheckpointPositions: 7,
			status: 'reconciling',
			updatedAt: '2026-09-07T00:00:00.000Z'
		});
		expect(query.mock.calls[1]?.[1]).toEqual([[source.archiveUrlIdentity]]);
		await attachArchiveScanCoverage(manager, [source]);
		expect(query).toHaveBeenCalledTimes(3);
		expect(archiveScanCoverageSummarySql).not.toMatch(
			/object_queue|object_event|checkpoint_proof|count\(distinct/i
		);
		expect(archiveScanCoverageSummarySql).toContain(
			'count(*) = 4 and bool_and(complete)'
		);
	});
	it('does not turn absent migration data into zero completed coverage', async () => {
		const { query, manager } = fixture();
		query.mockResolvedValue([{ ready: false }]);
		expect(await attachArchiveScanCoverage(manager, [source])).toEqual([
			source
		]);
		expect(query).toHaveBeenCalledTimes(1);
	});
	it('does not call the seed complete below known durable coverage', async () => {
		const { query, manager } = fixture();
		query
			.mockResolvedValueOnce([{ ready: true }])
			.mockResolvedValue([
				{
					archiveUrlIdentity: source.archiveUrlIdentity,
					checkedCheckpointPositions: 2,
					listingCoveredCheckpointPositions: 0,
					scannedCheckpointPositions: 2,
					complete: true,
					updatedAt: null,
					listingGapRanges: []
				}
			]);
		const [row] = await attachArchiveScanCoverage(manager, [source]);
		expect(row?.scanCoverage?.status).toBe('reconciling');
		expect(archiveScanCoverageSummarySql).toContain('limit 5');
	});
	it('does not query when no sources are requested', async () => {
		const { query, manager } = fixture();
		expect(await attachArchiveScanCoverage(manager, [])).toEqual([]);
		expect(query).not.toHaveBeenCalled();
	});
});
