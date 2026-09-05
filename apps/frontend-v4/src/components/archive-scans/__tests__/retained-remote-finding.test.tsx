/// <reference types="jest" />
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PublicKnownArchiveRemoteFailure } from '../../../api/archive-evidence-types';
import { unresolvedRemoteFailureCount } from '../../../domain/known-archive-evidence';
import { RetainedRemoteFinding } from '../retained-remote-finding';

describe('retained source findings', () => {
	it('shows a source 404 separately from the current local worker failure', () => {
		const markup = renderToStaticMarkup(
			createElement(RetainedRemoteFinding, { failure: failure() })
		);
		expect(markup).toContain('HTTP 404');
		expect(markup).toContain('Source file missing');
		expect(markup).toContain(
			'remains unresolved until this source verifies successfully'
		);
		expect(markup).toContain('Current check: Failed');
		expect(markup).toContain('Worker process unavailable');
	});
	it('uses the unresolved total once and falls back to old current-failure counts', () => {
		expect(
			unresolvedRemoteFailureCount({
				remoteFailureObjects: 1,
				unresolvedRemoteFailureObjects: 3
			})
		).toBe(3);
		expect(unresolvedRemoteFailureCount({ remoteFailureObjects: 1 })).toBe(1);
	});
	it('does not invent a prior source finding for an older API response', () => {
		const { retainedFinding: _, ...oldFailure } = failure();
		const markup = renderToStaticMarkup(
			createElement(RetainedRemoteFinding, { failure: oldFailure })
		);
		expect(markup).toContain('Worker process unavailable');
		expect(markup).not.toContain('HTTP 404');
		expect(markup).not.toContain('remains unresolved');
	});
});

function failure(): PublicKnownArchiveRemoteFailure {
	return {
		networkVerifiedCopies: { count: 0, copies: [], sampleLimit: 10 },
		sameOrganizationVerifiedCopies: { count: 0, copies: [], sampleLimit: 10 },
		retainedFinding: {
			observedAt: '2026-09-01T12:00:00Z',
			failureChannel: 'archive_availability',
			errorType: 'HISTORY_FILE_NOT_FOUND',
			errorMessage: 'Source file missing',
			httpStatus: 404
		},
		object: {
			archiveUrl: 'https://source.example',
			archiveUrlIdentity: 'https://source.example',
			objectUrl: 'https://source.example/ledger/0000003f.xdr.gz',
			objectType: 'ledger',
			objectKey: 'ledger:0000003f',
			remoteId: '11111111-1111-4111-8111-111111111111',
			checkpointLedger: 63,
			bucketHash: null,
			bytesDownloaded: null,
			attempts: 2,
			claimedAt: null,
			delayReason: null,
			nextAttemptAt: null,
			refreshAfter: null,
			status: 'failed',
			updatedAt: '2026-09-02T12:00:00Z',
			verifiedAt: null,
			workerStage: 'failed',
			verificationFacts: null,
			error: {
				type: 'scanner_issue',
				message: 'Worker process unavailable',
				httpStatus: null
			}
		}
	};
}
