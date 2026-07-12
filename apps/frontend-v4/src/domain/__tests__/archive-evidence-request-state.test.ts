/// <reference types="jest" />

import {
	appendCursorPage,
	beginArchiveEvidenceRequest,
	createArchiveEvidenceRequestState,
	createCursorHistory,
	currentCursorPage,
	nextCachedCursorPage,
	previousCursorPage,
	rejectArchiveEvidenceRequest,
	resolveArchiveEvidenceRequest,
	visibleArchiveEvidenceData
} from '../archive-evidence-request-state';

interface Query {
	readonly status: 'pending' | 'scanning' | 'verified';
}

interface Data {
	readonly rows: readonly string[];
}

interface CursorPage {
	readonly nextCursor: string | null;
	readonly rows: readonly string[];
}

const pendingQuery = { status: 'pending' } as const;
const scanningQuery = { status: 'scanning' } as const;
const verifiedQuery = { status: 'verified' } as const;

describe('archive evidence request state', () => {
	it('clears prior-query rows and keeps a query-specific error on failure', () => {
		const initial = createState();
		const loading = beginArchiveEvidenceRequest(
			initial,
			scanningQuery,
			'scanning',
			1
		);

		expect(visibleArchiveEvidenceData(loading)).toBeNull();
		const failed = rejectArchiveEvidenceRequest(loading, 1, 'Request failed');

		expect(visibleArchiveEvidenceData(failed)).toBeNull();
		expect(failed.requestedQuery).toEqual(scanningQuery);
		expect(failed.error).toEqual({
			message: 'Request failed',
			querySignature: 'scanning'
		});
	});

	it('commits a changed query and its returned page together', () => {
		const loading = beginArchiveEvidenceRequest(
			createState(),
			scanningQuery,
			'scanning',
			1
		);
		const resolved = resolveArchiveEvidenceRequest(
			loading,
			metadata(1, 'scanning'),
			{ rows: ['new'] },
			(_current, response) => response
		);

		expect(resolved.committed?.query).toEqual(scanningQuery);
		expect(visibleArchiveEvidenceData(resolved)).toEqual({ rows: ['new'] });
	});

	it('rolls same-query pagination failure back to the committed page', () => {
		const loading = beginArchiveEvidenceRequest(
			createState(),
			pendingQuery,
			'pending',
			2
		);

		expect(visibleArchiveEvidenceData(loading)).toEqual({ rows: ['old'] });
		const failed = rejectArchiveEvidenceRequest(loading, 2, 'Next page failed');

		expect(visibleArchiveEvidenceData(failed)).toEqual({ rows: ['old'] });
		expect(failed.error?.querySignature).toBe('pending');
	});

	it('discards late generations without changing the active request', () => {
		const first = beginArchiveEvidenceRequest(
			createState(),
			scanningQuery,
			'scanning',
			3
		);
		const latest = beginArchiveEvidenceRequest(
			first,
			verifiedQuery,
			'verified',
			4
		);
		const lateResolution = resolveArchiveEvidenceRequest(
			latest,
			metadata(3, 'scanning'),
			{ rows: ['late'] },
			(_current, response) => response
		);
		const lateRejection = rejectArchiveEvidenceRequest(
			lateResolution,
			3,
			'Late failure'
		);

		expect(lateRejection).toBe(latest);
		expect(lateRejection.requestedQuery).toEqual(verifiedQuery);
		expect(visibleArchiveEvidenceData(lateRejection)).toBeNull();
	});

	it('rejects a response whose query signature does not match', () => {
		const loading = beginArchiveEvidenceRequest(
			createState(),
			scanningQuery,
			'scanning',
			5
		);
		const mismatched = resolveArchiveEvidenceRequest(
			loading,
			metadata(5, 'pending'),
			{ rows: ['wrong'] },
			(_current, response) => response
		);

		expect(visibleArchiveEvidenceData(mismatched)).toBeNull();
		expect(mismatched.phase).toBe('error');
		expect(mismatched.error?.querySignature).toBe('scanning');
	});

	it('retains actual cursor pages for previous and cached-next navigation', () => {
		const first: CursorPage = { nextCursor: 'cursor-2', rows: ['first'] };
		const second: CursorPage = { nextCursor: null, rows: ['second'] };
		const twoPages = appendCursorPage(
			createCursorHistory<CursorPage>(first),
			second
		);
		const previous = previousCursorPage(twoPages);
		const cachedNext = nextCachedCursorPage(previous);

		expect(currentCursorPage(previous)).toBe(first);
		expect(cachedNext).not.toBeNull();
		if (cachedNext === null) throw new Error('Expected a cached next page');
		expect(currentCursorPage(cachedNext)).toBe(second);
	});
});

function createState() {
	return createArchiveEvidenceRequestState<Query, Data>(
		pendingQuery,
		'pending',
		'2026-07-10T00:00:00.000Z',
		{ rows: ['old'] }
	);
}

function metadata(requestGeneration: number, querySignature: string) {
	return {
		evidenceGeneratedAt: '2026-07-10T00:01:00.000Z',
		querySignature,
		requestGeneration
	};
}
