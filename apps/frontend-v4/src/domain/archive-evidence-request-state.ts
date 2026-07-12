import type { ArchiveEvidenceActionMetadata } from './known-archive-evidence-request';

export interface ArchiveEvidenceCommit<Query, Data> {
	readonly data: Data;
	readonly evidenceGeneratedAt: string;
	readonly query: Query;
	readonly querySignature: string;
}

export interface ArchiveEvidenceRequestState<Query, Data> {
	readonly activeGeneration: number;
	readonly committed: ArchiveEvidenceCommit<Query, Data> | null;
	readonly error: ArchiveEvidenceRequestError | null;
	readonly phase: 'error' | 'loading' | 'ready';
	readonly requestedQuery: Query;
	readonly requestedQuerySignature: string;
}

export interface ArchiveEvidenceRequestError {
	readonly message: string;
	readonly querySignature: string;
}

export interface CursorHistory<Page> {
	readonly index: number;
	readonly pages: readonly Page[];
}

export function createArchiveEvidenceRequestState<Query, Data>(
	query: Query,
	querySignature: string,
	evidenceGeneratedAt: string,
	data: Data
): ArchiveEvidenceRequestState<Query, Data> {
	return {
		activeGeneration: 0,
		committed: { data, evidenceGeneratedAt, query, querySignature },
		error: null,
		phase: 'ready',
		requestedQuery: query,
		requestedQuerySignature: querySignature
	};
}

export function beginArchiveEvidenceRequest<Query, Data>(
	state: ArchiveEvidenceRequestState<Query, Data>,
	query: Query,
	querySignature: string,
	requestGeneration: number
): ArchiveEvidenceRequestState<Query, Data> {
	return {
		...state,
		activeGeneration: requestGeneration,
		error: null,
		phase: 'loading',
		requestedQuery: query,
		requestedQuerySignature: querySignature
	};
}

export function resolveArchiveEvidenceRequest<Query, CurrentData, ResponseData>(
	state: ArchiveEvidenceRequestState<Query, CurrentData>,
	metadata: ArchiveEvidenceActionMetadata,
	responseData: ResponseData,
	merge: (current: CurrentData | null, response: ResponseData) => CurrentData
): ArchiveEvidenceRequestState<Query, CurrentData> {
	if (metadata.requestGeneration !== state.activeGeneration) return state;
	if (metadata.querySignature !== state.requestedQuerySignature) {
		return rejectArchiveEvidenceRequest(
			state,
			metadata.requestGeneration,
			'Archive evidence response did not match the requested query.'
		);
	}
	const current =
		state.committed?.querySignature === metadata.querySignature
			? state.committed.data
			: null;
	return {
		...state,
		committed: {
			data: merge(current, responseData),
			evidenceGeneratedAt: metadata.evidenceGeneratedAt,
			query: state.requestedQuery,
			querySignature: metadata.querySignature
		},
		error: null,
		phase: 'ready'
	};
}

export function rejectArchiveEvidenceRequest<Query, Data>(
	state: ArchiveEvidenceRequestState<Query, Data>,
	requestGeneration: number,
	message: string
): ArchiveEvidenceRequestState<Query, Data> {
	if (requestGeneration !== state.activeGeneration) return state;
	return {
		...state,
		error: { message, querySignature: state.requestedQuerySignature },
		phase: 'error'
	};
}

export function updateArchiveEvidenceData<Query, Data>(
	state: ArchiveEvidenceRequestState<Query, Data>,
	update: (data: Data) => Data
): ArchiveEvidenceRequestState<Query, Data> {
	if (
		state.committed === null ||
		state.committed.querySignature !== state.requestedQuerySignature
	) {
		return state;
	}
	return {
		...state,
		committed: {
			...state.committed,
			data: update(state.committed.data)
		},
		error: null,
		phase: 'ready'
	};
}

export function visibleArchiveEvidenceData<Query, Data>(
	state: ArchiveEvidenceRequestState<Query, Data>
): Data | null {
	if (
		state.committed === null ||
		state.committed.querySignature !== state.requestedQuerySignature
	) {
		return null;
	}
	return state.committed.data;
}

export function createCursorHistory<Page>(page: Page): CursorHistory<Page> {
	return { index: 0, pages: [page] };
}

export function currentCursorPage<Page>(history: CursorHistory<Page>): Page {
	const page = history.pages[history.index];
	if (page === undefined)
		throw new Error('Archive evidence page history is empty');
	return page;
}

export function appendCursorPage<Page>(
	history: CursorHistory<Page>,
	page: Page
): CursorHistory<Page> {
	return {
		index: history.index + 1,
		pages: [...history.pages.slice(0, history.index + 1), page]
	};
}

export function nextCachedCursorPage<Page>(
	history: CursorHistory<Page>
): CursorHistory<Page> | null {
	if (history.index + 1 >= history.pages.length) return null;
	return { ...history, index: history.index + 1 };
}

export function previousCursorPage<Page>(
	history: CursorHistory<Page>
): CursorHistory<Page> {
	return { ...history, index: Math.max(0, history.index - 1) };
}
