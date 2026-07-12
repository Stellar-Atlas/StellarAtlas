import { canonicalJsonContentDigest } from 'shared/lib/canonical-json-content-digest.js';
import { deriveLegacyCheckpointContentDigest } from '../HistoryArchiveLegacyCheckpointDigestBackfill.js';

const checkpointLedger = 1_000_063;
const objectUrl =
	'https://archive.example/history/history/00/0f/42/history-000f427f.json';
const state = {
	currentBuckets: [{ curr: 'ab'.repeat(32), snap: '0'.repeat(64) }],
	hotArchiveBuckets: []
};

describe('legacy checkpoint content digest backfill', () => {
	it('uses the same canonical digest as new scanner verification', () => {
		expect(deriveLegacyCheckpointContentDigest(row())).toEqual(
			canonicalJsonContentDigest(state)
		);
	});

	it('rejects evidence whose source URL or byte count does not match', () => {
		expect(
			deriveLegacyCheckpointContentDigest({
				...row(),
				bytesDownloaded: Buffer.byteLength(JSON.stringify(state)) + 1
			})
		).toBeNull();
		expect(
			deriveLegacyCheckpointContentDigest({
				...row(),
				objectUrl: 'https://different.example/history.json'
			})
		).toBeNull();
	});
});

function row() {
	return {
		bytesDownloaded: Buffer.byteLength(JSON.stringify(state)),
		checkpointLedger,
		objectUrl,
		remoteId: '00000000-0000-4000-8000-000000000001',
		verificationFacts: {
			checkpointHistoryArchiveState: {
				stellarHistory: state,
				stellarHistoryUrl: objectUrl
			},
			checkpointHistoryArchiveStateFact: {
				checkpointLedger,
				stellarHistoryUrl: objectUrl
			}
		}
	};
}
