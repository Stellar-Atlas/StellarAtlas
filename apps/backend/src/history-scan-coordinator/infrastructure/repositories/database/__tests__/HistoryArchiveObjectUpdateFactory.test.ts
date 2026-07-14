import {
	createFailedUpdate,
	createVerifiedUpdate
} from '../HistoryArchiveObjectUpdateFactory.js';

describe('HistoryArchiveObjectUpdateFactory', () => {
	it('preserves the terminal verification stage on verified object rows', () => {
		const update = createVerifiedUpdate({
			bytesDownloaded: 1024,
			claimAttempt: 3,
			workerStage: 'verified_bucket'
		});

		expect(update).toMatchObject({
			bytesDownloaded: 1024,
			claimedAt: null,
			claimedByCommunityScannerId: null,
			errorMessage: null,
			errorType: null,
			failureChannel: null,
			httpStatus: null,
			nextAttemptAt: null,
			status: 'verified',
			workerStage: 'verified_bucket'
		});
	});

	it('uses a readable terminal stage for failed object rows', () => {
		const update = createFailedUpdate({
			claimAttempt: 2,
			errorMessage: 'HTTP 429 Too Many Requests',
			errorType: 'TYPE_HTTP_STATUS',
			failureChannel: 'archive_evidence',
			httpStatus: 429,
			nextAttemptAt: new Date('2026-07-06T16:00:00.000Z')
		});

		expect(update).toMatchObject({
			claimedAt: null,
			claimedByCommunityScannerId: null,
			errorMessage: 'HTTP 429 Too Many Requests',
			errorType: 'TYPE_HTTP_STATUS',
			failureChannel: 'archive_evidence',
			httpStatus: 429,
			status: 'failed',
			workerStage: 'failed'
		});
	});

	it('persists structured evidence supplied with a failed object', () => {
		const verificationFacts = {
			checkpointHistoryArchiveStateFact: {
				bucketListHash: 'hash',
				checkpointLedger: 191,
				observedAt: '2026-07-14T00:00:00.000Z',
				stellarHistoryUrl: 'https://archive.example/history.json'
			}
		};
		const update = createFailedUpdate({
			claimAttempt: 1,
			errorMessage: 'checkpoint mismatch',
			errorType: 'checkpoint_state_ledger_mismatch',
			failureChannel: 'archive_evidence',
			verificationFacts
		});

		expect(update).toMatchObject({ verificationFacts });
	});
});
