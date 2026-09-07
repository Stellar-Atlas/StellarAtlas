/// <reference types="jest" />
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PublicKnownArchiveRootEvidence } from '../../../api/archive-evidence-types';
import {
	ArchiveSourceOverview,
	sourceCheckpointCoverage
} from '../archive-source-overview';
import {
	ArchiveSourceErrorSummary,
	describeArchiveFailure
} from '../archive-source-error-summary';
import { formatCoveragePercent } from '../archive-inventory-model';

function root(): PublicKnownArchiveRootEvidence {
	return {
		archiveUrl: 'https://archive.example/Case',
		archiveUrlIdentity: 'https://archive.example/Case',
		nodePublicKeys: [],
		latestObjectAt: null,
		scannerOwnedState: null,
		checkpoints: {
			verifiedCheckpoints: 2,
			totalCheckpoints: 2,
			pendingCheckpoints: 0,
			mismatchedCheckpoints: 0,
			notEvaluableCheckpoints: 0
		},
		objects: {
			activeObjects: 0,
			bucketObjects: 0,
			pendingObjects: 0,
			remoteFailureObjects: 650,
			totalObjects: 660,
			verifiedBucketObjects: 0,
			verifiedObjects: 10,
			workerIssueObjects: 84
		},
		sequentialCoverage: {
			advertisedLatestCheckpointLedger: 6399,
			blockedCheckpointLedger: null,
			blocker: null,
			lastContinuouslyVerifiedCheckpointLedger: 63,
			nextCheckpointLedger: 127,
			status: 'advancing'
		},
		listingGapCount: 1,
		failureSummary: {
			status: 'current',
			computedAt: '2026-09-06T23:00:00.000Z',
			limit: 20,
			totalGroups: 2,
			remainingGroupCount: 0,
			remainingFailureCount: 0,
			remoteFailureCount: 650,
			workerIssueCount: 84,
			groups: [
				{
					objectType: 'checkpoint-state',
					failureChannel: 'archive_availability',
					errorType: 'archive-http-error',
					errorMessage: 'Request failed with status code 404',
					httpStatus: 404,
					count: 600
				},
				{
					objectType: 'scp',
					failureChannel: 'archive_availability',
					errorType: 'archive-http-error',
					errorMessage: 'AccessDenied',
					httpStatus: 403,
					count: 50
				}
			]
		}
	};
}

describe('archive source summary', () => {
	it('uses every advertised checkpoint, not just materialized rows, for percentage', () => {
		const source = root();
		expect(sourceCheckpointCoverage(source)).toEqual({
			expected: 100,
			verified: 2,
			percent: 2
		});
		const html = renderToStaticMarkup(
			createElement(ArchiveSourceOverview, { root: source })
		);
		expect(html).toContain('2.00% verified');
		expect(html).toContain('max="100" value="2"');
		expect(html).toContain(
			'Missing or unchecked positions are not counted as verified'
		);
		expect(html).toContain('Ledger 63');
	});
	it('does not invent a percentage for absent or inconsistent head metadata', () => {
		const source = root();
		expect(
			sourceCheckpointCoverage({
				...source,
				sequentialCoverage: {
					...source.sequentialCoverage,
					advertisedLatestCheckpointLedger: null
				}
			}).percent
		).toBeNull();
		expect(
			sourceCheckpointCoverage({
				...source,
				checkpoints: { ...source.checkpoints, verifiedCheckpoints: 101 }
			}).percent
		).toBeNull();
	});
	it('never rounds incomplete coverage up to 100%', () => {
		expect(formatCoveragePercent(99.99999)).toBe('>99.999%');
		expect(formatCoveragePercent(100)).toBe('100%');
	});
	it('shows full-source reason counts and exact messages, separate from worker issues and listing gaps', () => {
		const html = renderToStaticMarkup(
			createElement(ArchiveSourceErrorSummary, {
				root: root(),
				onInspect: () => undefined
			})
		);
		expect(html).toContain('650');
		expect(html).toContain('600');
		expect(html).toContain('50');
		expect(html).toContain('Checkpoint state');
		expect(html).toContain('HTTP 404 — file not found at the requested URL');
		expect(html).toContain('Request failed with status code 404');
		expect(html).toContain('AccessDenied');
		expect(html).toContain('1 missing-file ranges');
		expect(html).not.toContain('84');
	});
	it('does not call a 403 proof of absence or a 404 rate limiting', () => {
		const common = {
			failureChannel: 'archive_availability' as const,
			errorType: 'archive-http-error'
		};
		expect(describeArchiveFailure({ ...common, httpStatus: 403 })).toContain(
			'does not establish whether the file exists'
		);
		expect(
			describeArchiveFailure({ ...common, httpStatus: 404 })
		).not.toContain('rate limit');
	});
	it('labels cached stale evidence and unavailable summaries without inventing zero failures', () => {
		const source = root();
		if (!source.failureSummary) throw new Error('Missing fixture summary');
		const stale = renderToStaticMarkup(
			createElement(ArchiveSourceErrorSummary, {
				root: {
					...source,
					failureSummary: { ...source.failureSummary, status: 'stale' }
				},
				onInspect: () => undefined
			})
		);
		expect(stale).toContain('showing the last summary');
		const unavailable = renderToStaticMarkup(
			createElement(ArchiveSourceErrorSummary, {
				root: { ...source, failureSummary: undefined },
				onInspect: () => undefined
			})
		);
		expect(unavailable).toContain('650');
		expect(unavailable).toContain(
			'Grouped reasons are temporarily unavailable'
		);
	});
});
