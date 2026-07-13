/// <reference types="jest" />

import type { HistoryArchiveEvidenceV2 } from 'shared';
import { parseHistoryArchiveEvidence } from '../history-archive-evidence-parser';
import { buildHistoryArchiveEvidencePath } from '../history-archive-evidence-path';

describe('history archive evidence parser', () => {
	it('builds and parses the v2 archive-source contract', () => {
		const response = createEvidence();
		expect(
			buildHistoryArchiveEvidencePath('https://archive.example/history')
		).toBe(
			'/v2/archive-scans/https%3A%2F%2Farchive.example%2Fhistory/object-evidence'
		);
		expect(parseHistoryArchiveEvidence(response)).toBe(response);
	});

	it('rejects the legacy v1 aggregate response', () => {
		expect(() =>
			parseHistoryArchiveEvidence({
				generatedAt: '2026-07-13T00:00:00.000Z',
				objects: [],
				summary: {}
			})
		).toThrow('did not match the v2 contract');
	});

	it('rejects a malformed nested page boundary', () => {
		const response = createEvidence();

		expect(() =>
			parseHistoryArchiveEvidence({
				...response,
				objectPage: {
					...response.objectPage,
					page: { ...response.objectPage.page, total: 'many' }
				}
			})
		).toThrow('did not match the v2 contract');
	});
});

function createEvidence(): HistoryArchiveEvidenceV2 {
	const snapshotAt = '2026-07-13T00:00:00.000Z';
	const page = {
		hasMore: false,
		limit: 25,
		nextCursor: null,
		snapshotAt,
		total: 0
	};
	const archiveUrl = 'https://archive.example/history';

	return {
		archiveUrl,
		eventPage: {
			events: [],
			filters: {
				archiveUrlIdentity: archiveUrl,
				evidenceClass: null,
				eventType: null,
				objectType: null
			},
			page
		},
		generatedAt: snapshotAt,
		objectPage: {
			filters: {
				archiveUrlIdentity: archiveUrl,
				objectType: null,
				status: null
			},
			objects: [],
			page
		},
		remoteFailures: {
			failures: [],
			filters: { archiveUrlIdentity: archiveUrl, objectType: null },
			...page
		},
		root: {
			archiveUrl,
			archiveUrlIdentity: archiveUrl,
			checkpoints: {
				mismatchedCheckpoints: 0,
				notEvaluableCheckpoints: 0,
				pendingCheckpoints: 0,
				totalCheckpoints: 0,
				verifiedCheckpoints: 0
			},
			latestObjectAt: null,
			nodePublicKeys: ['GNODE'],
			objects: {
				activeObjects: 0,
				bucketObjects: 0,
				pendingObjects: 0,
				remoteFailureObjects: 0,
				totalObjects: 0,
				verifiedBucketObjects: 0,
				verifiedObjects: 0,
				workerIssueObjects: 0
			},
			scannerOwnedState: null
		},
		workerIssues: {
			filters: { archiveUrlIdentity: archiveUrl, objectType: null },
			issues: [],
			...page
		}
	};
}
