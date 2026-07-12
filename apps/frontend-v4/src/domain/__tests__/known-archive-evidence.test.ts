/// <reference types="jest" />

import type {
	PublicHistoryArchiveEvidence,
	PublicKnownNodeArchiveEvidence
} from '../../api/archive-evidence-types';
import {
	assessKnownArchiveEvidence,
	getHttpUrl,
	getVerifiedCopyObjectUrl,
	toKnownArchiveEvidence,
	type PublicKnownArchiveVerifiedCopy
} from '../known-archive-evidence';

describe('known archive evidence', () => {
	it('keeps remote failure precedence over worker issues', () => {
		const evidence = createEvidence({
			remoteFailureObjects: 1,
			workerIssueObjects: 2
		});

		expect(assessKnownArchiveEvidence(evidence)).toBe('remote_failure');
	});

	it('classifies infrastructure evidence independently', () => {
		const evidence = createEvidence({ workerIssueObjects: 1 });

		expect(assessKnownArchiveEvidence(evidence)).toBe('scanner_issue');
	});

	it('uses current object work for checking and waiting states', () => {
		expect(
			assessKnownArchiveEvidence(createEvidence({ activeObjects: 1 }))
		).toBe('checking');
		expect(
			assessKnownArchiveEvidence(createEvidence({ pendingObjects: 1 }))
		).toBe('waiting');
	});

	it('marks only a complete current object set as verified', () => {
		const evidence = createEvidence({ totalObjects: 3, verifiedObjects: 3 });

		expect(assessKnownArchiveEvidence(evidence)).toBe('verified');
	});

	it('uses only an exact backend-proven verified-copy object URL', () => {
		const exactUrl =
			'https://copy.example/history/bucket/aa/bb/cc/bucket-aabbcc.xdr.gz';

		expect(getVerifiedCopyObjectUrl(createVerifiedCopy(exactUrl))).toBe(
			exactUrl
		);
	});

	it('does not fall back to the archive root for an invalid object URL', () => {
		expect(
			getVerifiedCopyObjectUrl(createVerifiedCopy('file:///srv/archive/object'))
		).toBeNull();
		expect(getHttpUrl(' https://copy.example/object ')).toBeNull();
		expect(getHttpUrl('https://copy.example/\nobject')).toBeNull();
		expect(getHttpUrl('javascript:alert(1)')).toBeNull();
	});

	it('adapts one archive-root response without inventing aggregate counts', () => {
		const source = createEvidence({ totalObjects: 4, verifiedObjects: 3 });
		const root = {
			archiveUrl: 'https://history.example/archive',
			archiveUrlIdentity: 'https://history.example/archive',
			checkpoints: source.totals.checkpoints,
			latestObjectAt: source.generatedAt,
			nodePublicKeys: ['GNODE', 'GNODE'],
			objects: source.totals.objects,
			scannerOwnedState: null
		};
		const archiveEvidence: PublicHistoryArchiveEvidence = {
			archiveUrl: root.archiveUrl,
			eventPage: source.eventPage,
			generatedAt: source.generatedAt,
			objectPage: source.objectPage,
			remoteFailures: source.remoteFailures,
			root,
			workerIssues: source.workerIssues
		};

		const adapted = toKnownArchiveEvidence(archiveEvidence);

		expect(adapted.roots).toEqual([root]);
		expect(adapted.nodePublicKeys).toEqual(['GNODE']);
		expect(adapted.totals).toEqual({
			archiveRoots: 1,
			checkpoints: root.checkpoints,
			nodes: 1,
			objects: root.objects
		});
	});
});

function createVerifiedCopy(objectUrl: string): PublicKnownArchiveVerifiedCopy {
	return {
		archiveUrl: 'https://copy.example/history',
		archiveUrlIdentity: 'https://copy.example/history',
		objectUrl,
		remoteId: 'copy-1',
		verifiedAt: '2026-07-10T00:00:00.000Z'
	};
}

function createEvidence(
	overrides: Partial<PublicKnownNodeArchiveEvidence['totals']['objects']>
): PublicKnownNodeArchiveEvidence {
	const objects = {
		activeObjects: 0,
		bucketObjects: 0,
		pendingObjects: 0,
		remoteFailureObjects: 0,
		totalObjects: 0,
		verifiedBucketObjects: 0,
		verifiedObjects: 0,
		workerIssueObjects: 0,
		...overrides
	};
	const page = {
		hasMore: false,
		limit: 10,
		nextCursor: null,
		snapshotAt: '2026-07-10T00:00:00.000Z',
		total: 0
	};
	const failureFilters = { archiveUrlIdentity: null, objectType: null };
	return {
		eventPage: {
			events: [],
			filters: {
				archiveUrlIdentity: null,
				evidenceClass: null,
				eventType: null,
				objectType: null
			},
			page
		},
		generatedAt: '2026-07-10T00:00:00.000Z',
		nodePublicKeys: ['GNODE'],
		objectPage: {
			filters: {
				archiveUrlIdentity: null,
				objectType: null,
				status: 'pending'
			},
			objects: [],
			page
		},
		organizationId: null,
		publicKey: 'GNODE',
		remoteFailures: {
			failures: [],
			filters: failureFilters,
			hasMore: false,
			limit: 10,
			nextCursor: null,
			snapshotAt: '2026-07-10T00:00:00.000Z',
			total: 0
		},
		roots: [],
		totals: {
			archiveRoots: 0,
			checkpoints: {
				mismatchedCheckpoints: 0,
				notEvaluableCheckpoints: 0,
				pendingCheckpoints: 0,
				totalCheckpoints: 0,
				verifiedCheckpoints: 0
			},
			nodes: 1,
			objects
		},
		workerIssues: {
			filters: failureFilters,
			hasMore: false,
			issues: [],
			limit: 10,
			nextCursor: null,
			snapshotAt: '2026-07-10T00:00:00.000Z',
			total: 0
		}
	};
}
