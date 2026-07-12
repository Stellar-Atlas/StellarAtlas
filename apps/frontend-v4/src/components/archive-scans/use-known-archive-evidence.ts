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
	const [, startTransition] = useTransition();
	const generation = useRef(0);
	const refreshLatest = useRef<() => Promise<void>>(async () => undefined);
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
	refreshLatest.current = async (): Promise<void> => {
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
		if (
			(tab === 'failures' || tab === 'repair') &&
			failureData?.remote.index === 0 &&
			failureData.worker.index === 0
		) {
			loadFailures(failureQuery.current, null, null, 'both');
		} else if (
			(tab === 'work' || tab === 'verified') &&
			objectData?.index === 0
		) {
			loadObjects(objectQuery.current, null, false);
		} else if (tab === 'activity' && eventData?.index === 0) {
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
		const query = objectQuery.current;
		if (nextTab === 'verified' && query.status !== 'verified') {
			loadObjects({ ...query, status: 'verified' }, null, false);
		}
		if (nextTab === 'work' && query.status === 'verified') {
			loadObjects({ ...query, status: 'pending' }, null, false);
		}
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
		evidence: liveEvidence,
		selectTab,
		tab
	};
}

export type KnownArchiveEvidenceViewState = ReturnType<
	typeof useKnownArchiveEvidence
>;
