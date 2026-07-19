/// <reference types="jest" />

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PublicKnownArchiveRootEvidence } from '../../../api/archive-evidence-types';
import {
	ArchiveSourceFilter,
	CursorPagination,
	EvidenceFilters
} from '../known-archive-evidence-controls';

describe('known archive evidence controls', () => {
	it('omits filters when a single result has no useful filter dimension', () => {
		const markup = renderToStaticMarkup(
			createElement(EvidenceFilters, {
				archiveUrl: null,
				disabled: false,
				objectType: null,
				onArchiveUrlChange: () => undefined,
				onObjectTypeChange: () => undefined,
				roots: [createRoot('https://one.example', ['GA'])],
				showObjectType: false
			})
		);

		expect(markup).toBe('');
	});

	it('shows how node records aggregate into each source option', () => {
		const markup = renderToStaticMarkup(
			createElement(ArchiveSourceFilter, {
				disabled: false,
				onChange: () => undefined,
				roots: [
					createRoot('https://one.example/history', ['GA', 'GB', 'GA']),
					createRoot('https://two.example', ['GC'])
				],
				value: null
			})
		);

		expect(markup).toContain('one.example/history - 2 nodes');
		expect(markup).toContain('two.example - 1 node');
	});

	it('omits a pager when neither direction can change the page', () => {
		const markup = renderPagination({ count: 1, hasMore: false, index: 0 });

		expect(markup).toBe('');
	});

	it('renders cursor navigation and a real result range for multiple pages', () => {
		const markup = renderPagination({ count: 10, hasMore: true, index: 0 });

		expect(markup).toContain('1-10 of 24');
		expect(markup).toContain('Previous');
		expect(markup).toContain('Next');
	});
});

function renderPagination({
	count,
	hasMore,
	index
}: {
	readonly count: number;
	readonly hasMore: boolean;
	readonly index: number;
}): string {
	return renderToStaticMarkup(
		createElement(CursorPagination, {
			count,
			disabled: false,
			hasMore,
			index,
			limit: 10,
			onNext: () => undefined,
			onPrevious: () => undefined,
			total: 24
		})
	);
}

function createRoot(
	archiveUrl: string,
	nodePublicKeys: readonly string[]
): PublicKnownArchiveRootEvidence {
	return {
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
		nodePublicKeys,
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
	};
}
