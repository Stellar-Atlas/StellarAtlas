'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import {
	loadKnownArchiveAggregate,
	loadKnownArchiveEventPage,
	loadKnownArchiveFailurePages,
	loadKnownArchiveObjectPage
} from '@app/actions/archive-evidence';
import {
	appendCursorPage,
	beginArchiveEvidenceRequest,
	createArchiveEvidenceRequestState,
	createCursorHistory,
	rejectArchiveEvidenceRequest,
	resolveArchiveEvidenceRequest,
	visibleArchiveEvidenceData,
	type ArchiveEvidenceRequestState
} from '@domain/archive-evidence-request-state';
import type {
	KnownArchiveEvidenceTab,
	PublicKnownArchiveEvidence
} from '@domain/known-archive-evidence';
import {
	eventQuerySignature,
	failureQuerySignature,
	objectQuerySignature,
	type ArchiveEvidenceActionResult,
	type ArchiveEvidenceEventQuery,
	type ArchiveEvidenceFailureQuery,
	type ArchiveEvidenceObjectQuery,
	type ArchiveEvidenceSubject
} from '@domain/known-archive-evidence-request';
import {
	getInitialEventQuery,
	getInitialFailureQuery,
	getInitialObjectQuery,
	getInitialRepairArchiveUrl,
	mergeFailurePages,
	type ArchiveEvidenceViewKey,
	type FailureRequestTarget
} from './known-archive-evidence-state';
import {
	buildActivityView,
	buildFailureView,
	buildObjectView
} from './known-archive-evidence-view-model';
import {
	mergeArchiveEvidenceAggregate,
	shouldRefreshFirstArchiveEvidencePage,
	startBoundedArchiveEvidenceRefresh
} from './archive-evidence-refresh';

const archiveEvidenceRefreshIntervalMs = 15_000;

export function useKnownArchiveEvidence(
	evidence: PublicKnownArchiveEvidence,
	subject: ArchiveEvidenceSubject
) {
	const [tab, setTab] = useState<KnownArchiveEvidenceTab>('failures');
	const [liveEvidence, setLiveEvidence] =
		useState<PublicKnownArchiveEvidence>(evidence);
	const [repairArchiveUrl, setRepairArchiveUrl] = useState<string | null>(() =>
		getInitialRepairArchiveUrl(evidence)
	);
	const [, startTransition] = useTransition();
	const generation = useRef(0);
	const refreshLatest = useRef<() => Promise<void>>(async () => undefined);
	const requestRevisions = useRef<Record<ArchiveEvidenceViewKey, number>>({
		activity: 0,
		failures: 0,
		objects: 0
	});
	const controllers = useRef<
		Record<ArchiveEvidenceViewKey, AbortController | null>
	>({
		activity: null,
		failures: null,
		objects: null
	});
	const retries = useRef<Record<ArchiveEvidenceViewKey, (() => void) | null>>({
		activity: null,
		failures: null,
		objects: null
	});
	const [failureErrorTarget, setFailureErrorTarget] =
		useState<FailureRequestTarget | null>(null);
	const initialFailureQuery = getInitialFailureQuery(evidence);
	const initialObjectQuery = getInitialObjectQuery(evidence);
	const initialEventQuery = getInitialEventQuery(evidence);
	const failureQuery = useRef(initialFailureQuery);
	const objectQuery = useRef(initialObjectQuery);
	const eventQuery = useRef(initialEventQuery);
	const [failureState, setFailureState] = useState(() =>
		createArchiveEvidenceRequestState(
			initialFailureQuery,
			failureQuerySignature(subject, initialFailureQuery),
			evidence.generatedAt,
			{
				remote: createCursorHistory(evidence.remoteFailures),
				worker: createCursorHistory(evidence.workerIssues)
			}
		)
	);
	const [objectState, setObjectState] = useState(() =>
		createArchiveEvidenceRequestState(
			initialObjectQuery,
			objectQuerySignature(subject, initialObjectQuery),
			evidence.generatedAt,
			createCursorHistory(evidence.objectPage)
		)
	);
	const [eventState, setEventState] = useState(() =>
		createArchiveEvidenceRequestState(
			initialEventQuery,
			eventQuerySignature(subject, initialEventQuery),
			evidence.generatedAt,
			createCursorHistory(evidence.eventPage)
		)
	);

	useEffect(
		() => () => {
			for (const controller of Object.values(controllers.current)) {
				controller?.abort();
			}
		},
		[]
	);
	useEffect(() => setLiveEvidence(evidence), [evidence]);
	useEffect(() => {
		setRepairArchiveUrl((current) =>
			current !== null &&
			liveEvidence.roots.some((root) => root.archiveUrl === current)
				? current
				: getInitialRepairArchiveUrl(liveEvidence)
		);
	}, [liveEvidence]);

	const runRequest = <Query, CurrentData, ResponseData>(
		key: ArchiveEvidenceViewKey,
		query: Query,
		querySignature: string,
		setState: React.Dispatch<
			React.SetStateAction<ArchiveEvidenceRequestState<Query, CurrentData>>
		>,
		load: (
			requestGeneration: number
		) => Promise<ArchiveEvidenceActionResult<ResponseData>>,
		merge: (current: CurrentData | null, response: ResponseData) => CurrentData,
		callbacks?: {
			readonly onError?: () => void;
			readonly onStart?: () => void;
			readonly onSuccess?: () => void;
		}
	): void => {
		controllers.current[key]?.abort();
		requestRevisions.current[key] += 1;
		const controller = new AbortController();
		controllers.current[key] = controller;
		const requestGeneration = ++generation.current;
		callbacks?.onStart?.();
		setState((state) =>
			beginArchiveEvidenceRequest(
				state,
				query,
				querySignature,
				requestGeneration
			)
		);
		startTransition(() => {
			void executeRequest();
		});

		async function executeRequest(): Promise<void> {
			try {
				const result = await load(requestGeneration);
				if (controller.signal.aborted) return;
				if (result.requestGeneration !== requestGeneration) {
					setState((state) =>
						rejectArchiveEvidenceRequest(
							state,
							requestGeneration,
							'Archive evidence response did not match the active request.'
						)
					);
					callbacks?.onError?.();
					return;
				}
				if (result.status === 'loaded') {
					if (result.querySignature !== querySignature) {
						setState((state) =>
							rejectArchiveEvidenceRequest(
								state,
								requestGeneration,
								'Archive evidence response did not match the requested query.'
							)
						);
						callbacks?.onError?.();
						return;
					}
					setState((state) =>
						resolveArchiveEvidenceRequest(state, result, result.data, merge)
					);
					callbacks?.onSuccess?.();
				} else {
					setState((state) =>
						rejectArchiveEvidenceRequest(
							state,
							result.requestGeneration,
							result.message
						)
					);
					callbacks?.onError?.();
				}
			} catch {
				if (controller.signal.aborted) return;
				setState((state) =>
					rejectArchiveEvidenceRequest(
						state,
						requestGeneration,
						'Archive evidence request could not be completed.'
					)
				);
				callbacks?.onError?.();
			} finally {
				if (controllers.current[key] === controller) {
					controllers.current[key] = null;
				}
			}
		}
	};

	const loadFailures = (
		query: ArchiveEvidenceFailureQuery,
		failureCursor: string | null,
		workerIssueCursor: string | null,
		target: FailureRequestTarget
	): void => {
		failureQuery.current = query;
		const request = (): void =>
			runRequest(
				'failures',
				query,
				failureQuerySignature(subject, query),
				setFailureState,
				(requestGeneration) =>
					loadKnownArchiveFailurePages({
						...query,
						failureCursor,
						requestGeneration,
						subject,
						workerIssueCursor
					}),
				(current, response) => mergeFailurePages(current, response, target),
				{
					onError: () => setFailureErrorTarget(target),
					onStart: () => setFailureErrorTarget(null),
					onSuccess: () => setFailureErrorTarget(null)
				}
			);
		retries.current.failures = request;
		request();
	};

	const loadObjects = (
		query: ArchiveEvidenceObjectQuery,
		cursor: string | null,
		append: boolean
	): void => {
		objectQuery.current = query;
		const request = (): void =>
			runRequest(
				'objects',
				query,
				objectQuerySignature(subject, query),
				setObjectState,
				(requestGeneration) =>
					loadKnownArchiveObjectPage({
						...query,
						cursor,
						requestGeneration,
						subject
					}),
				(current, page) =>
					append && current !== null
						? appendCursorPage(current, page)
						: createCursorHistory(page)
			);
		retries.current.objects = request;
		request();
	};

	const loadEvents = (
		query: ArchiveEvidenceEventQuery,
		cursor: string | null,
		append: boolean
	): void => {
		eventQuery.current = query;
		const request = (): void =>
			runRequest(
				'activity',
				query,
				eventQuerySignature(subject, query),
				setEventState,
				(requestGeneration) =>
					loadKnownArchiveEventPage({
						...query,
						cursor,
						requestGeneration,
						subject
					}),
				(current, page) =>
					append && current !== null
						? appendCursorPage(current, page)
						: createCursorHistory(page)
			);
		retries.current.activity = request;
		request();
	};

	const failureData = visibleArchiveEvidenceData(failureState);
	const objectData = visibleArchiveEvidenceData(objectState);
	const eventData = visibleArchiveEvidenceData(eventState);
	const refreshView = useRef({
		eventIndex: eventData?.index,
		eventPhase: eventState.phase,
		failurePhase: failureState.phase,
		failureRemoteIndex: failureData?.remote.index,
		failureWorkerIndex: failureData?.worker.index,
		objectIndex: objectData?.index,
		objectPhase: objectState.phase,
		tab
	});
	refreshView.current = {
		eventIndex: eventData?.index,
		eventPhase: eventState.phase,
		failurePhase: failureState.phase,
		failureRemoteIndex: failureData?.remote.index,
		failureWorkerIndex: failureData?.worker.index,
		objectIndex: objectData?.index,
		objectPhase: objectState.phase,
		tab
	};
	refreshLatest.current = async (): Promise<void> => {
		const startedRevisions = { ...requestRevisions.current };
		const requestGeneration = ++generation.current;
		const result = await loadKnownArchiveAggregate({
			requestGeneration,
			subject
		});
		if (
			result.status !== 'loaded' ||
			result.requestGeneration !== requestGeneration
		) {
			return;
		}
		setLiveEvidence((current) =>
			mergeArchiveEvidenceAggregate(current, result.data)
		);
		const currentView = refreshView.current;
		if (
			currentView.tab === 'failures' &&
			shouldRefreshFirstArchiveEvidencePage(
				currentView.failurePhase,
				currentView.failureRemoteIndex,
				controllers.current.failures !== null,
				startedRevisions.failures === requestRevisions.current.failures
			) &&
			currentView.failureWorkerIndex === 0
		) {
			loadFailures(failureQuery.current, null, null, 'both');
		} else if (
			(currentView.tab === 'work' || currentView.tab === 'verified') &&
			shouldRefreshFirstArchiveEvidencePage(
				currentView.objectPhase,
				currentView.objectIndex,
				controllers.current.objects !== null,
				startedRevisions.objects === requestRevisions.current.objects
			)
		) {
			loadObjects(objectQuery.current, null, false);
		} else if (
			currentView.tab === 'activity' &&
			shouldRefreshFirstArchiveEvidencePage(
				currentView.eventPhase,
				currentView.eventIndex,
				controllers.current.activity !== null,
				startedRevisions.activity === requestRevisions.current.activity
			)
		) {
			loadEvents(eventQuery.current, null, false);
		}
	};
	useEffect(
		() =>
			startBoundedArchiveEvidenceRefresh(
				() => refreshLatest.current(),
				archiveEvidenceRefreshIntervalMs
			),
		[]
	);

	const selectTab = (nextTab: KnownArchiveEvidenceTab): void => {
		setTab(nextTab);
		if (
			shouldLoadInitialActivityPage(nextTab, eventData?.pages[0]?.page.limit)
		) {
			loadEvents(eventQuery.current, null, false);
			return;
		}
		const query = objectQuery.current;
		const nextQuery = getObjectQueryForTab(nextTab, query);
		if (nextQuery !== null) loadObjects(nextQuery, null, false);
	};

	return {
		activity: buildActivityView(
			eventState,
			eventData,
			loadEvents,
			setEventState,
			retries,
			() => eventQuery.current
		),
		failures: buildFailureView(
			failureState,
			failureData,
			loadFailures,
			setFailureState,
			retries,
			failureErrorTarget,
			() => failureQuery.current
		),
		objects: buildObjectView(
			objectState,
			objectData,
			loadObjects,
			setObjectState,
			retries,
			() => objectQuery.current
		),
		repair: {
			archiveUrl: repairArchiveUrl,
			changeArchiveUrl: setRepairArchiveUrl
		},
		evidence: liveEvidence,
		selectTab,
		tab
	};
}

export type KnownArchiveEvidenceViewState = ReturnType<
	typeof useKnownArchiveEvidence
>;

export function getObjectQueryForTab(
	tab: KnownArchiveEvidenceTab,
	query: ArchiveEvidenceObjectQuery
): ArchiveEvidenceObjectQuery | null {
	if (tab === 'verified' && query.status !== 'verified') {
		return { ...query, status: 'verified' };
	}
	if (
		tab === 'work' &&
		query.status !== 'pending' &&
		query.status !== 'scanning'
	) {
		return { ...query, status: 'pending' };
	}
	return null;
}

export function shouldLoadInitialActivityPage(
	tab: KnownArchiveEvidenceTab,
	pageLimit: number | undefined
): boolean {
	return tab === 'activity' && pageLimit === 0;
}
