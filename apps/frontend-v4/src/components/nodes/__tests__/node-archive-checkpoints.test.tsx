import { jest } from '@jest/globals';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type {
	PublicKnownArchiveRemoteFailure,
	PublicKnownArchiveRootEvidence
} from '../../../api/archive-evidence-types';
import { getArchiveScanDetailPath } from '../../../domain/archive-scan-routes';
import { nodeArchiveCheckpointModel } from '../node-archive-checkpoint-model';

jest.unstable_mockModule('../node-archive-checkpoints.module.css', () => ({
	default: {}
}));
const { NodeArchiveCheckpoints } = await import('../node-archive-checkpoints');

const rootUrl = 'https://archive.example/ArchiveCase';
function root(
	overrides: Partial<PublicKnownArchiveRootEvidence> = {}
): PublicKnownArchiveRootEvidence {
	return {
		archiveUrl: rootUrl,
		archiveUrlIdentity: rootUrl,
		nodePublicKeys: ['GTEST'],
		latestObjectAt: null,
		checkpoints: {
			verifiedCheckpoints: 20,
			totalCheckpoints: 20,
			pendingCheckpoints: 0,
			mismatchedCheckpoints: 0,
			notEvaluableCheckpoints: 0
		},
		objects: {
			activeObjects: 2,
			bucketObjects: 30,
			pendingObjects: 7,
			remoteFailureObjects: 0,
			totalObjects: 9999,
			verifiedBucketObjects: 15,
			verifiedObjects: 8000,
			workerIssueObjects: 0
		},
		scannerOwnedState: null,
		sequentialCoverage: {
			advertisedLatestCheckpointLedger: 6399,
			blockedCheckpointLedger: null,
			blocker: null,
			lastContinuouslyVerifiedCheckpointLedger: 1279,
			nextCheckpointLedger: 1343,
			status: 'advancing'
		},
		...overrides
	};
}
function failure(
	type: PublicKnownArchiveRemoteFailure['object']['objectType'],
	status = 404,
	message = 'Not found',
	errorType = 'http_error'
): PublicKnownArchiveRemoteFailure {
	const copies = {
		copies: [],
		count: null,
		lookupStatus: 'not_requested' as const,
		sampleLimit: 0
	};
	return {
		networkVerifiedCopies: copies,
		sameOrganizationVerifiedCopies: copies,
		object: {
			archiveUrl: rootUrl,
			archiveUrlIdentity: rootUrl,
			objectKey: type + ':0000003f',
			objectType: type,
			objectUrl: rootUrl + '/file',
			remoteId: 'remote-' + type,
			status: 'failed',
			workerStage: null,
			checkpointLedger: 63,
			bucketHash: null,
			bytesDownloaded: null,
			attempts: 1,
			delayReason: null,
			nextAttemptAt: null,
			refreshAfter: null,
			claimedAt: null,
			updatedAt: '2026-09-08T00:00:00Z',
			verificationFacts: null,
			verifiedAt: null,
			error: { httpStatus: status, type: errorType, message }
		}
	};
}
function render(
	roots: readonly PublicKnownArchiveRootEvidence[],
	failures: readonly PublicKnownArchiveRemoteFailure[] = []
): string {
	return renderToStaticMarkup(
		createElement(NodeArchiveCheckpoints, { roots, failures })
	);
}

describe('node archive checkpoint summary', () => {
	it('uses advertised checkpoint positions, not files or materialized proof rows', () => {
		const model = nodeArchiveCheckpointModel(root(), []);
		expect(model).toMatchObject({ verified: 20, expected: 100, percent: 20 });
		const html = render([root()]);
		expect(html).toContain('20 / 100');
		expect(html).toContain('checkpoint positions verified');
		expect(html).not.toContain('8,000 / 9,999');
		expect(html).toContain('Ledger 1,343');
		expect(html).not.toContain('Continuously verified through');
		expect(html).not.toContain('Ledger 1,279');
		expect(html).toContain(
			'Scanning can continue past recorded archive failures'
		);
		expect(html).toContain(getArchiveScanDetailPath(rootUrl));
	});
	it('does not invent a denominator or percentage when the advertised head is unknown', () => {
		const current = root();
		const value = root({
			sequentialCoverage: {
				...current.sequentialCoverage,
				advertisedLatestCheckpointLedger: null
			}
		});
		const html = render([value]);
		expect(html).toContain('20 / unknown');
		expect(html).toContain('Percentage unavailable');
		expect(html).not.toContain('<progress');
	});
	it('does not clamp inconsistent evidence into a false 100 percent', () => {
		const current = root();
		expect(
			nodeArchiveCheckpointModel(
				root({
					checkpoints: { ...current.checkpoints, verifiedCheckpoints: 101 }
				}),
				[]
			).percent
		).toBeNull();
	});
	it('keeps roots case-sensitive and never combines their file findings', () => {
		const original = failure('results');
		const other = {
			...original,
			object: { ...original.object, archiveUrlIdentity: rootUrl.toLowerCase() }
		};
		expect(
			nodeArchiveCheckpointModel(root(), [
				failure('ledger'),
				other
			]).findings.map((item) => item.type)
		).toEqual(['ledger']);
	});
	it.each(['aborted', 'ERR_CANCELED', 'ECONNRESET', 'connection timeout'])(
		'separates %s transport evidence even after HTTP 200',
		(message) => {
			const model = nodeArchiveCheckpointModel(root(), [
				failure('ledger', 200, message, message)
			]);
			expect(model.findings).toEqual([]);
			expect(model.inconclusiveOnPage).toBe(1);
		}
	);
	it('retains an original source 404 when the current worker check has a local error', () => {
		const current = failure('ledger', 200, 'ECONNRESET', 'ECONNRESET');
		const retained: PublicKnownArchiveRemoteFailure = {
			...current,
			retainedFinding: {
				observedAt: '2026-09-07T00:00:00Z',
				failureChannel: 'archive_availability',
				httpStatus: 404,
				errorType: 'http_error',
				errorMessage: 'Not found'
			}
		};
		expect(
			nodeArchiveCheckpointModel(root(), [retained]).findings[0]?.reasons
		).toEqual(['HTTP 404: file not found at the requested URL']);
	});
	it('does not call access-denied evidence a missing file', () => {
		const model = nodeArchiveCheckpointModel(root(), [failure('bucket', 403)]);
		expect(model.findings[0]?.reasons).toEqual([
			'HTTP 403: access denied; file existence unknown'
		]);
	});
	it('shows listing-only gaps without adding absent positions to verified coverage', () => {
		const value = root({
			listingGapCount: 1,
			listingGaps: [
				{
					kind: 'directory-listing-gap',
					firstCheckpointLedger: 1343,
					lastCheckpointLedger: 1983,
					resumeCheckpointLedger: 2047,
					checkpointCount: 11,
					observedAt: '2026-09-08T00:00:00Z',
					sourceCheckpointProofId: null,
					sourceArchiveUrlIdentity: null,
					listings: (
						['history', 'ledger', 'transactions', 'results'] as const
					).map((category) => ({
						category,
						listingUrl: rootUrl + '/' + category + '/',
						responseSha256: 'a'.repeat(64),
						firstReturnedKey: null,
						firstReturnedCheckpoint: null,
						completePrefix: category + '/00/00/05/',
						rangeThroughCheckpoint: 1983
					}))
				}
			]
		});
		const html = render([value]);
		expect(html).toContain('20 / 100');
		expect(html).toContain('1 missing-file ranges');
		expect(html).toContain('11 positions');
		expect(html).toContain('not absent buckets or SCP files');
		expect(html).toContain('not marked verified by the listing');
	});
	it('labels supplied findings as a page sample and keeps infrastructure separate', () => {
		const current = root();
		const value = root({
			objects: {
				...current.objects,
				remoteFailureObjects: 400,
				workerIssueObjects: 3
			}
		});
		const html = render([value], [failure('ledger')]);
		expect(html).toContain('400 unresolved checks');
		expect(html).toContain('Ledger headers: 1');
		expect(html).toContain('on this page');
		expect(html).toContain('3 infrastructure checks');
		expect(html).not.toContain('400 archive faults');
	});
	it('explains the real file structure without claiming SCP signatures or buckets per checkpoint', () => {
		const html = render([root()]);
		for (const path of [
			'.well-known/stellar-history.json',
			'history/aa/bb/cc/',
			'ledger/aa/bb/cc/',
			'transactions/aa/bb/cc/',
			'results/aa/bb/cc/',
			'bucket/aa/bb/cc/',
			'scp/aa/bb/cc/'
		])
			expect(html).toContain(path);
		expect(html).toContain('a bucket can serve many checkpoints');
		expect(html).toContain('does not authenticate SCP signatures');
	});
});
