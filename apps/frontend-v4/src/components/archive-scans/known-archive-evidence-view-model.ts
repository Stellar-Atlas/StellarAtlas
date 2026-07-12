import type { Dispatch, RefObject, SetStateAction } from 'react';
import {
	currentCursorPage,
	nextCachedCursorPage,
	previousCursorPage,
	updateArchiveEvidenceData,
	type ArchiveEvidenceRequestState
} from '@domain/archive-evidence-request-state';
import type {
	ArchiveEvidenceEventQuery,
	ArchiveEvidenceFailureQuery,
	ArchiveEvidenceObjectQuery
} from '@domain/known-archive-evidence-request';
import type {
	ArchiveEvidenceViewKey,
	EventCursorData,
	FailureCursorData,
	FailureRequestTarget,
	ObjectCursorData
} from './known-archive-evidence-state';

type RetryRef = RefObject<Record<ArchiveEvidenceViewKey, (() => void) | null>>;

export function buildFailureView(
	state: ArchiveEvidenceRequestState<
		ArchiveEvidenceFailureQuery,
		FailureCursorData
	>,
	data: FailureCursorData | null,
	load: (
		query: ArchiveEvidenceFailureQuery,
		failureCursor: string | null,
		workerIssueCursor: string | null,
		target: FailureRequestTarget
	) => void,
	setState: Dispatch<SetStateAction<typeof state>>,
	retries: RetryRef,
	errorTarget: FailureRequestTarget | null,
	getQuery: () => ArchiveEvidenceFailureQuery
) {
	const remotePage = data === null ? null : currentCursorPage(data.remote);
	const workerPage = data === null ? null : currentCursorPage(data.worker);
	return {
		...state.requestedQuery,
		changeArchiveUrl: (archiveUrl: string | null) =>
			load({ ...getQuery(), archiveUrl }, null, null, 'both'),
		changeObjectType: (objectType: ArchiveEvidenceFailureQuery['objectType']) =>
			load({ ...getQuery(), objectType }, null, null, 'both'),
		error: state.error?.message ?? null,
		errorTarget,
		isLoading: state.phase === 'loading',
		nextRemote: () => {
			if (data === null || remotePage === null) return;
			const cached = nextCachedCursorPage(data.remote);
			if (cached) {
				updateFailureData(setState, (value) => ({ ...value, remote: cached }));
			} else {
				load(getQuery(), remotePage.nextCursor, null, 'remote');
			}
		},
		nextWorker: () => {
			if (data === null || workerPage === null) return;
			const cached = nextCachedCursorPage(data.worker);
			if (cached) {
				updateFailureData(setState, (value) => ({ ...value, worker: cached }));
			} else {
				load(getQuery(), null, workerPage.nextCursor, 'worker');
			}
		},
		previousRemote: () =>
			updateFailureData(setState, (value) => ({
				...value,
				remote: previousCursorPage(value.remote)
			})),
		previousWorker: () =>
			updateFailureData(setState, (value) => ({
				...value,
				worker: previousCursorPage(value.worker)
			})),
		remotePage,
		remotePageIndex: data?.remote.index ?? 0,
		retry: () => retries.current.failures?.(),
		workerPage,
		workerPageIndex: data?.worker.index ?? 0
	};
}

export function buildObjectView(
	state: ArchiveEvidenceRequestState<
		ArchiveEvidenceObjectQuery,
		ObjectCursorData
	>,
	data: ObjectCursorData | null,
	load: (
		query: ArchiveEvidenceObjectQuery,
		cursor: string | null,
		append: boolean
	) => void,
	setState: Dispatch<SetStateAction<typeof state>>,
	retries: RetryRef,
	getQuery: () => ArchiveEvidenceObjectQuery
) {
	const page = data === null ? null : currentCursorPage(data);
	return {
		...state.requestedQuery,
		changeArchiveUrl: (archiveUrl: string | null) =>
			load({ ...getQuery(), archiveUrl }, null, false),
		changeObjectType: (objectType: ArchiveEvidenceObjectQuery['objectType']) =>
			load({ ...getQuery(), objectType }, null, false),
		changeStatus: (status: 'pending' | 'scanning') =>
			load({ ...getQuery(), status }, null, false),
		error: state.error?.message ?? null,
		isLoading: state.phase === 'loading',
		next: () => {
			if (data === null || page === null) return;
			const cached = nextCachedCursorPage(data);
			if (cached) updateCursorData(setState, () => cached);
			else load(getQuery(), page.page.nextCursor, true);
		},
		page,
		pageIndex: data?.index ?? 0,
		previous: () => updateCursorData(setState, previousCursorPage),
		retry: () => retries.current.objects?.()
	};
}

export function buildActivityView(
	state: ArchiveEvidenceRequestState<
		ArchiveEvidenceEventQuery,
		EventCursorData
	>,
	data: EventCursorData | null,
	load: (
		query: ArchiveEvidenceEventQuery,
		cursor: string | null,
		append: boolean
	) => void,
	setState: Dispatch<SetStateAction<typeof state>>,
	retries: RetryRef,
	getQuery: () => ArchiveEvidenceEventQuery
) {
	const page = data === null ? null : currentCursorPage(data);
	return {
		...state.requestedQuery,
		changeArchiveUrl: (archiveUrl: string | null) =>
			load({ ...getQuery(), archiveUrl }, null, false),
		changeEvidenceClass: (
			evidenceClass: ArchiveEvidenceEventQuery['evidenceClass']
		) => load({ ...getQuery(), evidenceClass }, null, false),
		changeObjectType: (objectType: ArchiveEvidenceEventQuery['objectType']) =>
			load({ ...getQuery(), objectType }, null, false),
		error: state.error?.message ?? null,
		isLoading: state.phase === 'loading',
		next: () => {
			if (data === null || page === null) return;
			const cached = nextCachedCursorPage(data);
			if (cached) updateCursorData(setState, () => cached);
			else load(getQuery(), page.page.nextCursor, true);
		},
		page,
		pageIndex: data?.index ?? 0,
		previous: () => updateCursorData(setState, previousCursorPage),
		retry: () => retries.current.activity?.()
	};
}

function updateFailureData(
	setState: Dispatch<
		SetStateAction<
			ArchiveEvidenceRequestState<
				ArchiveEvidenceFailureQuery,
				FailureCursorData
			>
		>
	>,
	update: (data: FailureCursorData) => FailureCursorData
): void {
	setState((state) => updateArchiveEvidenceData(state, update));
}

function updateCursorData<Query, Data>(
	setState: Dispatch<SetStateAction<ArchiveEvidenceRequestState<Query, Data>>>,
	update: (data: Data) => Data
): void {
	setState((state) => updateArchiveEvidenceData(state, update));
}
