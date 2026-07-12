import Ajv from 'ajv';
import * as addFormats from 'ajv-formats';
import { HistoryArchiveStatusSummaryV1Schema } from '../../src/dto/history-archive-status-summary-v1';

describe('HistoryArchiveStatusSummaryV1', () => {
	it('validates explicit bounded checkpoint-proof status', () => {
		const validate = createValidator();

		expect(validate(createSummary())).toBe(true);
		expect(validate.errors).toBeNull();
	});

	it('requires sources and rejects legacy object-total fields', () => {
		const validate = createValidator();
		const summary = createSummary();
		const { sources: _sources, ...withoutSources } = summary;

		expect(validate(withoutSources)).toBe(false);
		expect(validate({ ...summary, activeObjects: 4 })).toBe(false);
	});
});

function createValidator() {
	const ajv = new Ajv();
	addFormats.default(ajv);
	return ajv.compile(HistoryArchiveStatusSummaryV1Schema);
}

function createSummary() {
	return {
		activeObjectChecks: 1,
		archiveEvidenceFailures: 0,
		checkpointCoverage: {
			activeArchiveCheckpoints: 0,
			archiveRootsWithState: 1,
			categoryConsistencyFailedCheckpoints: 0,
			categoryConsistencyNotEvaluatedCheckpoints: 0,
			categoryConsistencyPendingCheckpoints: 1,
			categoryConsistentArchiveCheckpoints: 3,
			completeArchiveCheckpoints: 3,
			discoveryCompleteArchiveRoots: 1,
			expectedArchiveCheckpoints: 4,
			failedArchiveCheckpoints: 0,
			latestCheckpointLedger: 255,
			missingArchiveCheckpoints: 0,
			objectCompleteArchiveCheckpoints: 3,
			oldestCheckpointLedger: 63,
			partialArchiveCheckpoints: 1,
			totalArchiveCheckpoints: 4
		},
		generatedAt: '2026-07-10T00:00:00.000Z',
		sourceCount: 1,
		sourceLimit: 256,
		scannerIssueFailures: 0,
		sources: [
			{
				activeObjectChecks: 1,
				archiveEvidenceFailures: 0,
				archiveUrl: 'https://archive.example',
				archiveUrlIdentity: 'https://archive.example',
				currentLedger: 255,
				latestCheckpointLedger: 255,
				latestDiscoveredCheckpointLedger: 255,
				mismatchCheckpointProofs: 0,
				notEvaluableCheckpointProofs: 0,
				objectCompleteCheckpointProofs: 3,
				observedAt: '2026-07-10T00:00:00.000Z',
				pendingCheckpointProofs: 1,
				rootObjectStatus: 'verified',
				rootFailureChannel: null,
				scannerIssueFailures: 0,
				source: 'network-scan',
				stateStatus: 'available',
				stateUrl: 'https://archive.example/.well-known/stellar-history.json',
				totalCheckpointProofs: 4,
				unclassifiedFailures: 0,
				verifiedCheckpointProofs: 3
			}
		],
		sourcesTruncated: false,
		unclassifiedFailures: 0
	};
}
