import { jest } from '@jest/globals';
import type { HistoryArchiveStatusSummaryV1 } from 'shared';

const fetchArchiveInventorySnapshot =
	jest.fn<
		typeof import('@api/archive-inventory-server').fetchArchiveInventorySnapshot
	>();
jest.unstable_mockModule('@api/archive-inventory-server', () => ({
	fetchArchiveInventorySnapshot
}));
const { GET } = await import('../route');

describe('stable archive inventory GET', () => {
	afterEach(() => jest.restoreAllMocks());
	it('returns a cacheable successful snapshot without a Server Action', async () => {
		const summary: HistoryArchiveStatusSummaryV1 = {
			activeObjectChecks: 0,
			archiveEvidenceFailures: 149209,
			canonicalProofProgress: {
				archiveUrl: null,
				archiveUrlIdentity: null,
				latestVerifiedCheckpointLedger: null,
				nextCheckpointLedger: null,
				remainingCheckpoints: 0,
				targetCheckpointLedger: null,
				totalCheckpoints: 0,
				verifiedCheckpoints: 0
			},
			checkpointCoverage: {
				activeArchiveCheckpoints: 0,
				archiveRootsWithState: 0,
				categoryConsistencyFailedCheckpoints: 0,
				categoryConsistencyNotEvaluatedCheckpoints: 0,
				categoryConsistencyPendingCheckpoints: 0,
				categoryConsistentArchiveCheckpoints: 0,
				completeArchiveCheckpoints: 0,
				durableVerifiedArchiveCheckpoints: 0,
				discoveryCompleteArchiveRoots: 0,
				expectedArchiveCheckpoints: 0,
				failedArchiveCheckpoints: 0,
				latestCheckpointLedger: null,
				missingArchiveCheckpoints: 0,
				objectCompleteArchiveCheckpoints: 0,
				oldestCheckpointLedger: null,
				partialArchiveCheckpoints: 0,
				totalArchiveCheckpoints: 0
			},
			generatedAt: '2026-09-05T20:00:00.000Z',
			sourceCount: 0,
			sourceLimit: 256,
			scannerIssueFailures: 0,
			sources: [],
			sourcesTruncated: false,
			transitionReconciliation: {
				oldestPendingAgeMs: null,
				oldestPendingAt: null,
				pendingTerminalEffects: 0,
				status: 'caught-up'
			},
			unclassifiedFailures: 0
		};
		const snapshot: Awaited<ReturnType<typeof fetchArchiveInventorySnapshot>> =
			{
				summary,
				nodes: [],
				organizations: []
			};
		jest.mocked(fetchArchiveInventorySnapshot).mockResolvedValue(snapshot);
		const response = await GET();
		expect(response.status).toBe(200);
		expect(response.headers.get('Cache-Control')).toContain(
			'stale-if-error=3600'
		);
		expect(await response.json()).toEqual(snapshot);
	});
	it('returns a bounded unavailable response instead of throwing a render error', async () => {
		jest.spyOn(console, 'error').mockImplementation(() => {});
		jest
			.mocked(fetchArchiveInventorySnapshot)
			.mockRejectedValue(new Error('private upstream details'));
		const response = await GET();
		expect(response.status).toBe(503);
		expect(response.headers.get('Cache-Control')).toBe('no-store');
		expect(await response.json()).toEqual({
			error: 'Archive inventory temporarily unavailable'
		});
	});
});
