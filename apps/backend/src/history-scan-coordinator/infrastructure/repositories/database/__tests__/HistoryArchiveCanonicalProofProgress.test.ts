import {
	mapCanonicalProofProgress,
	resolveCanonicalProofProgressArchiveUrlIdentity
} from '../HistoryArchiveObjectStatusSummaryQuery.js';

describe('canonical archive proof progress', () => {
	it('uses a reporting root independently of the bootstrap scheduling gate', () => {
		expect(
			resolveCanonicalProofProgressArchiveUrlIdentity({
				HISTORY_ARCHIVE_CANONICAL_FIRST_ROOT: '',
				HISTORY_ARCHIVE_CANONICAL_STATUS_ROOT:
					'http://history.stellar.org/prd/core-live/core_live_001/'
			})
		).toBe('http://history.stellar.org/prd/core-live/core_live_001');
	});
	it('counts only the contiguous proven chain before the open frontier', () => {
		expect(
			mapCanonicalProofProgress(
				{
					archiveUrl: 'https://archive.example',
					archiveUrlIdentity: 'https://archive.example',
					currentLedger: 639,
					frontierStatus: 'pending',
					nextHistoricalCheckpointLedger: 191
				},
				'https://archive.example'
			)
		).toEqual({
			archiveUrl: 'https://archive.example',
			archiveUrlIdentity: 'https://archive.example',
			latestVerifiedCheckpointLedger: 63,
			nextCheckpointLedger: 127,
			remainingCheckpoints: 9,
			targetCheckpointLedger: 639,
			totalCheckpoints: 10,
			verifiedCheckpoints: 1
		});
	});

	it('includes a verified frontier before its cursor advances', () => {
		expect(
			mapCanonicalProofProgress(
				{
					currentLedger: 639,
					frontierStatus: 'verified',
					nextHistoricalCheckpointLedger: 191
				},
				'https://archive.example'
			)
		).toMatchObject({
			latestVerifiedCheckpointLedger: 127,
			nextCheckpointLedger: 191,
			remainingCheckpoints: 8,
			totalCheckpoints: 10,
			verifiedCheckpoints: 2
		});
	});

	it('reports genesis as the next position before the chain begins', () => {
		expect(
			mapCanonicalProofProgress(
				{
					currentLedger: 639,
					nextHistoricalCheckpointLedger: 127
				},
				'https://archive.example'
			)
		).toMatchObject({
			latestVerifiedCheckpointLedger: null,
			nextCheckpointLedger: 63,
			remainingCheckpoints: 10,
			verifiedCheckpoints: 0
		});
	});
});
