/// <reference types="jest" />

import type {
	PublicHistoryArchiveObjectSummary,
	PublicHistoryArchiveStatusSummary
} from '../../api/types';
import {
	archiveHealthTone,
	archiveHealthVocabulary,
	assessArchiveHealth,
	assessArchiveScannerHealth,
	assessArchiveStatusHealth,
	checkpointStatusProofIsComplete,
	getArchiveFailureState
} from '../history-archive-health';

describe('history archive health', () => {
	it('exposes the one public archive-health vocabulary', () => {
		expect(archiveHealthVocabulary).toEqual([
			'verified',
			'checking',
			'waiting',
			'remote_failure',
			'scanner_issue',
			'unknown'
		]);
	});

	it('makes checkpoint mismatch beat active and waiting work', () => {
		const summary = createSummary({
			activeObjects: 3,
			checkpoints: {
				activeArchiveCheckpoints: 3,
				categoryConsistencyFailedCheckpoints: 1,
				categoryConsistencyPendingCheckpoints: 2,
				expectedArchiveCheckpoints: 4,
				totalArchiveCheckpoints: 4
			},
			failedObjects: 1,
			pendingObjects: 2,
			totalObjects: 4
		});

		const result = assessArchiveHealth({
			evidenceAvailable: true,
			summary
		});

		expect(result.state).toBe('remote_failure');
		expect(archiveHealthTone(result.state)).toBe('danger');
	});

	it('makes remote evidence beat a simultaneous scanner issue', () => {
		const summary = createSummary({
			activeObjects: 1,
			failedObjects: 1,
			hostThrottles: [createHostThrottle('worker-infrastructure')],
			totalObjects: 2
		});

		const result = assessArchiveHealth({
			evidenceAvailable: true,
			scannerIssue: true,
			summary
		});

		expect(result.state).toBe('remote_failure');
		expect(result.facts.scannerIssues).toBe(2);
	});

	it('classifies infrastructure evidence as a scanner issue', () => {
		const summary = createSummary({
			activeObjects: 2,
			hostThrottles: [createHostThrottle('coordinator-infrastructure')],
			pendingObjects: 3,
			totalObjects: 5
		});

		expect(
			assessArchiveHealth({ evidenceAvailable: true, summary }).state
		).toBe('scanner_issue');
	});

	it('requires complete checkpoint proof before rendering green', () => {
		const incomplete = createSummary({
			checkpoints: {
				categoryConsistencyPendingCheckpoints: 1,
				categoryConsistentArchiveCheckpoints: 1,
				expectedArchiveCheckpoints: 2,
				totalArchiveCheckpoints: 2
			},
			pendingObjects: 1,
			totalObjects: 2,
			verifiedObjects: 1
		});
		const complete = createSummary({
			checkpoints: {
				categoryConsistentArchiveCheckpoints: 2,
				expectedArchiveCheckpoints: 2,
				totalArchiveCheckpoints: 2
			},
			totalObjects: 2,
			verifiedObjects: 2
		});

		const incompleteHealth = assessArchiveHealth({
			evidenceAvailable: true,
			summary: incomplete
		});
		const completeHealth = assessArchiveHealth({
			evidenceAvailable: true,
			summary: complete
		});

		expect(incompleteHealth.state).toBe('waiting');
		expect(archiveHealthTone(incompleteHealth.state)).not.toBe('good');
		expect(completeHealth.state).toBe('verified');
		expect(archiveHealthTone(completeHealth.state)).toBe('good');
	});

	it('uses checking, waiting, and unknown for incomplete evidence', () => {
		const checking = createSummary({ activeObjects: 1, totalObjects: 1 });
		const waiting = createSummary({ pendingObjects: 1, totalObjects: 1 });
		const empty = createSummary({});

		expect(
			assessArchiveHealth({ evidenceAvailable: true, summary: checking }).state
		).toBe('checking');
		expect(
			assessArchiveHealth({ evidenceAvailable: true, summary: waiting }).state
		).toBe('waiting');
		expect(
			assessArchiveHealth({ evidenceAvailable: true, summary: empty }).state
		).toBe('unknown');
		expect(
			assessArchiveHealth({ evidenceAvailable: false, summary: checking }).state
		).toBe('unknown');
	});

	it('keeps scanner runtime state inside the archive vocabulary', () => {
		expect(
			assessArchiveScannerHealth({
				activeChecks: 4,
				configuredWorkers: 24,
				proofComplete: false,
				staleChecks: 0,
				telemetryAvailable: true,
				waitingChecks: 2,
				workerStatus: 'ok'
			})
		).toBe('checking');
		expect(
			assessArchiveScannerHealth({
				activeChecks: 4,
				configuredWorkers: 24,
				proofComplete: false,
				staleChecks: 1,
				telemetryAvailable: true,
				waitingChecks: 2,
				workerStatus: 'degraded'
			})
		).toBe('scanner_issue');
	});

	it('maps event evidence classes without conflating remote and scanner failures', () => {
		expect(getArchiveFailureState('archive-object')).toBe('remote_failure');
		expect(getArchiveFailureState('worker-infrastructure')).toBe(
			'scanner_issue'
		);
		expect(getArchiveFailureState('coordinator-infrastructure')).toBe(
			'scanner_issue'
		);
		expect(getArchiveFailureState(null)).toBe('unknown');
	});

	it('assesses the fast status contract without interpreting proofs as objects', () => {
		const waiting = createStatusSummary({
			activeObjectChecks: 20,
			checkpointCoverage: {
				categoryConsistencyPendingCheckpoints: 1,
				categoryConsistentArchiveCheckpoints: 3,
				expectedArchiveCheckpoints: 4,
				totalArchiveCheckpoints: 4
			}
		});
		const mismatch = createStatusSummary({
			checkpointCoverage: {
				categoryConsistencyFailedCheckpoints: 1,
				expectedArchiveCheckpoints: 1,
				totalArchiveCheckpoints: 1
			}
		});

		expect(
			assessArchiveStatusHealth({ evidenceAvailable: true, summary: waiting })
				.state
		).toBe('checking');
		expect(
			assessArchiveStatusHealth({ evidenceAvailable: true, summary: mismatch })
				.state
		).toBe('remote_failure');
		expect(checkpointStatusProofIsComplete(waiting)).toBe(false);
	});

	it('keeps remote, scanner, and legacy failure channels distinct', () => {
		const remoteAndScanner = createStatusSummary({
			archiveEvidenceFailures: 1,
			scannerIssueFailures: 2
		});
		const scanner = createStatusSummary({ scannerIssueFailures: 1 });
		const legacy = createStatusSummary({ unclassifiedFailures: 1 });

		expect(
			assessArchiveStatusHealth({
				evidenceAvailable: true,
				summary: remoteAndScanner
			}).state
		).toBe('remote_failure');
		expect(
			assessArchiveStatusHealth({ evidenceAvailable: true, summary: scanner })
				.state
		).toBe('scanner_issue');
		expect(
			assessArchiveStatusHealth({ evidenceAvailable: true, summary: legacy })
				.state
		).toBe('unknown');
	});
});

type SummaryOverrides = Omit<
	Partial<PublicHistoryArchiveObjectSummary>,
	'checkpoints'
> & {
	readonly checkpoints?: Partial<
		PublicHistoryArchiveObjectSummary['checkpoints']
	>;
};

function createSummary(
	overrides: SummaryOverrides
): PublicHistoryArchiveObjectSummary {
	const summary: PublicHistoryArchiveObjectSummary = {
		activeObjects: 0,
		archiveUrl: null,
		archiveUrlIdentity: null,
		buckets: {
			activeBucketObjects: 0,
			failedBucketObjects: 0,
			pendingBucketObjects: 0,
			totalBucketObjects: 0,
			uniqueBucketHashes: 0,
			verifiedBucketObjects: 0
		},
		checkpoints: {
			activeArchiveCheckpoints: 0,
			archiveRootsWithState: 0,
			categoryConsistencyFailedCheckpoints: 0,
			categoryConsistencyNotEvaluatedCheckpoints: 0,
			categoryConsistencyPendingCheckpoints: 0,
			categoryConsistentArchiveCheckpoints: 0,
			completeArchiveCheckpoints: 0,
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
		failedObjects: 0,
		generatedAt: '2026-07-10T00:00:00.000Z',
		hostThrottles: [],
		objectTypes: [],
		pendingObjects: 0,
		scope: 'global',
		sources: [],
		totalObjects: 0,
		verifiedObjects: 0
	};

	return {
		...summary,
		...overrides,
		checkpoints: {
			...summary.checkpoints,
			...overrides.checkpoints
		}
	};
}

function createHostThrottle(
	evidenceClass: PublicHistoryArchiveObjectSummary['hostThrottles'][number]['evidenceClass']
): PublicHistoryArchiveObjectSummary['hostThrottles'][number] {
	return {
		archiveUrlIdentity: 'https://history.example.com',
		blockedUntil: '2026-07-10T00:05:00.000Z',
		consecutiveFailures: 1,
		errorType: 'scanner_error',
		evidenceClass,
		failureClass: evidenceClass === 'archive-object' ? 'transport' : 'worker',
		hostIdentity: 'history.example.com',
		httpStatus: null,
		lastFailureAt: '2026-07-10T00:00:00.000Z'
	};
}

function createStatusSummary(overrides: {
	readonly activeObjectChecks?: number;
	readonly archiveEvidenceFailures?: number;
	readonly checkpointCoverage?: Partial<
		PublicHistoryArchiveStatusSummary['checkpointCoverage']
	>;
	readonly scannerIssueFailures?: number;
	readonly unclassifiedFailures?: number;
}): PublicHistoryArchiveStatusSummary {
	const checkpointCoverage = {
		activeArchiveCheckpoints: 0,
		archiveRootsWithState: 1,
		categoryConsistencyFailedCheckpoints: 0,
		categoryConsistencyNotEvaluatedCheckpoints: 0,
		categoryConsistencyPendingCheckpoints: 0,
		categoryConsistentArchiveCheckpoints: 0,
		completeArchiveCheckpoints: 0,
		discoveryCompleteArchiveRoots: 0,
		expectedArchiveCheckpoints: 0,
		failedArchiveCheckpoints: 0,
		latestCheckpointLedger: null,
		missingArchiveCheckpoints: 0,
		objectCompleteArchiveCheckpoints: 0,
		oldestCheckpointLedger: null,
		partialArchiveCheckpoints: 0,
		totalArchiveCheckpoints: 0,
		...overrides.checkpointCoverage
	};
	return {
		activeObjectChecks: overrides.activeObjectChecks ?? 0,
		archiveEvidenceFailures: overrides.archiveEvidenceFailures ?? 0,
		checkpointCoverage,
		generatedAt: '2026-07-10T00:00:00.000Z',
		sourceCount: 0,
		sourceLimit: 256,
		scannerIssueFailures: overrides.scannerIssueFailures ?? 0,
		sources: [],
		sourcesTruncated: false,
		unclassifiedFailures: overrides.unclassifiedFailures ?? 0
	};
}
