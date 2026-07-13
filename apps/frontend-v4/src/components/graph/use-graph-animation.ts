import {
	useCallback,
	useEffect,
	useRef,
	type Dispatch,
	type RefObject,
	type SetStateAction
} from 'react';
import type { ForceGraph3DInstance } from '3d-force-graph';
import type { GraphVisualState } from './graph-visual-state';
import type { Graph3DNode } from './model-3d';
import {
	ledgerPlaybackDurationMs,
	type LedgerPlaybackFrame
} from './scp-flow-paths';
import { buildStatementWaveSchedule } from './graph-wave-schedule';
import {
	getLedgerStatementSignature,
	mergePlaybackQueue
} from './graph-playback-queue';
import {
	updateWaveMeshPool,
	type ActiveWave,
	type WaveMeshPool
} from './graph-wave-animation';
import {
	activateStatementFlowPath,
	activeStatementLifetimeMs,
	animateStatementPacket,
	clearGraphAnimationEffects,
	getStatementLaunchDeadlineMs,
	removeTrackedTimeout
} from './graph-animation-effects';

interface UseGraphAnimationOptions {
	activeWavesRef: RefObject<Map<number, ActiveWave>>;
	activityTimeoutsRef: RefObject<number[]>;
	animatedStatementHashesRef: RefObject<Set<string>>;
	animationTimeoutsRef: RefObject<number[]>;
	animationsEnabled: boolean;
	animationsEnabledRef: RefObject<boolean>;
	graphRef: RefObject<ForceGraph3DInstance | null>;
	nextWaveIndexRef: RefObject<number>;
	nodeActivityRef: RefObject<Map<string, number>>;
	nodesByIdRef: RefObject<Map<string, Graph3DNode>>;
	playbackBoundarySlotIndex: string | null;
	playbackLedgers: readonly LedgerPlaybackFrame[];
	refreshGraphVisuals: () => void;
	setActivePlaybackSlotIndex: Dispatch<SetStateAction<string | null>>;
	setActiveStatementHashes: Dispatch<SetStateAction<ReadonlySet<string>>>;
	threeRef: RefObject<typeof import('three') | null>;
	visualStateRef: RefObject<GraphVisualState>;
	waveAnimationFrameRef: RefObject<number | null>;
	wavePoolRef: RefObject<WaveMeshPool | null>;
}

export const useGraphAnimation = ({
	activeWavesRef,
	activityTimeoutsRef,
	animatedStatementHashesRef,
	animationTimeoutsRef,
	animationsEnabled,
	animationsEnabledRef,
	graphRef,
	nextWaveIndexRef,
	nodeActivityRef,
	nodesByIdRef,
	playbackBoundarySlotIndex,
	playbackLedgers,
	refreshGraphVisuals,
	setActivePlaybackSlotIndex,
	setActiveStatementHashes,
	threeRef,
	waveAnimationFrameRef,
	wavePoolRef
}: UseGraphAnimationOptions): {
	clearAnimationEffects: () => void;
	scheduleWaveAnimation: () => void;
} => {
	const activeLedgerRef = useRef<LedgerPlaybackFrame | null>(null);
	const playbackQueueRef = useRef<LedgerPlaybackFrame[]>([]);
	const playbackStartedAtRef = useRef(0);
	const pausedPlaybackElapsedMsRef = useRef<number | null>(null);
	const playbackFinishTimeoutRef = useRef<number | null>(null);
	const pendingStatementHashesRef = useRef<Set<string>>(new Set());
	const completedSlotSignaturesRef = useRef<Map<string, string>>(new Map());
	const completedSlotOrderRef = useRef<string[]>([]);
	const latestStartedSlotIndexRef = useRef<string | null>(null);
	const advancePlaybackRef = useRef<() => void>(() => undefined);

	const updateWaveAnimations = useCallback(
		(now: number): void => {
			const pool = wavePoolRef.current;
			if (!pool) {
				activeWavesRef.current.clear();
				waveAnimationFrameRef.current = null;
				return;
			}

			updateWaveMeshPool(pool, activeWavesRef.current, now);
			if (animationsEnabledRef.current) {
				graphRef.current?.resumeAnimation();
				waveAnimationFrameRef.current =
					window.requestAnimationFrame(updateWaveAnimations);
				return;
			}

			waveAnimationFrameRef.current = null;
		},
		[
			activeWavesRef,
			animationsEnabledRef,
			graphRef,
			waveAnimationFrameRef,
			wavePoolRef
		]
	);

	const scheduleWaveAnimation = useCallback((): void => {
		if (!animationsEnabledRef.current) return;
		advancePlaybackRef.current();
		if (waveAnimationFrameRef.current !== null) return;
		graphRef.current?.resumeAnimation();
		waveAnimationFrameRef.current =
			window.requestAnimationFrame(updateWaveAnimations);
	}, [
		animationsEnabledRef,
		graphRef,
		updateWaveAnimations,
		waveAnimationFrameRef
	]);

	const clearAnimationEffects = useCallback(
		(preserveAnimatedStatements = false): void => {
			clearGraphAnimationEffects({
				activeWavesRef,
				activityTimeoutsRef,
				animatedStatementHashesRef,
				animationTimeoutsRef,
				nodeActivityRef,
				pendingStatementHashes: pendingStatementHashesRef.current,
				preserveAnimatedStatements,
				refreshGraphVisuals,
				setActiveStatementHashes,
				waveAnimationFrameRef,
				wavePoolRef
			});
		},
		[
			activeWavesRef,
			activityTimeoutsRef,
			animatedStatementHashesRef,
			animationTimeoutsRef,
			nodeActivityRef,
			refreshGraphVisuals,
			setActiveStatementHashes,
			waveAnimationFrameRef,
			wavePoolRef
		]
	);

	const clearPlaybackFinishTimeout = useCallback((): void => {
		if (playbackFinishTimeoutRef.current === null) return;
		window.clearTimeout(playbackFinishTimeoutRef.current);
		playbackFinishTimeoutRef.current = null;
	}, []);

	const markSlotCompleted = useCallback((ledger: LedgerPlaybackFrame): void => {
		if (!completedSlotSignaturesRef.current.has(ledger.slotIndex)) {
			completedSlotOrderRef.current.push(ledger.slotIndex);
		}
		completedSlotSignaturesRef.current.set(
			ledger.slotIndex,
			getLedgerStatementSignature(ledger)
		);

		while (completedSlotOrderRef.current.length > 32) {
			const expiredSlotIndex = completedSlotOrderRef.current.shift();
			if (expiredSlotIndex)
				completedSlotSignaturesRef.current.delete(expiredSlotIndex);
		}
	}, []);

	const scheduleLedgerStatements = useCallback(
		(ledger: LedgerPlaybackFrame): void => {
			if (
				!animationsEnabledRef.current ||
				!graphRef.current ||
				ledger.statements.length === 0
			) {
				return;
			}

			const elapsedMs = performance.now() - playbackStartedAtRef.current;
			if (elapsedMs > getStatementLaunchDeadlineMs(ledger)) return;

			const schedule = buildStatementWaveSchedule({
				animatedStatementHashes: animatedStatementHashesRef.current,
				elapsedMs,
				ledger,
				nodesById: nodesByIdRef.current
			});
			for (const { delayMs, flowPath, statement } of schedule) {
				animatedStatementHashesRef.current.add(statement.statementHash);
				pendingStatementHashesRef.current.add(statement.statementHash);
				let timeout = 0;
				timeout = window.setTimeout(() => {
					removeTrackedTimeout(animationTimeoutsRef.current, timeout);
					pendingStatementHashesRef.current.delete(statement.statementHash);
					const activeLedger = activeLedgerRef.current;
					if (
						!animationsEnabledRef.current ||
						activeLedger?.slotIndex !== ledger.slotIndex
					) {
						animatedStatementHashesRef.current.delete(statement.statementHash);
						return;
					}
					const launchElapsedMs =
						performance.now() - playbackStartedAtRef.current;
					if (launchElapsedMs > getStatementLaunchDeadlineMs(activeLedger)) {
						return;
					}
					activateStatementFlowPath({
						activityTimeoutsRef,
						nodeActivityRef,
						path: flowPath,
						refreshGraphVisuals
					});
					animateStatementPacket({
						activeWavesRef,
						nextWaveIndexRef,
						path: flowPath,
						scheduleWaveAnimation,
						statement,
						threeRef,
						wavePoolRef
					});
					setActiveStatementHashes((current) => {
						const next = new Set(current);
						next.add(statement.statementHash);
						return next;
					});
					let clearActiveStatement = 0;
					clearActiveStatement = window.setTimeout(() => {
						removeTrackedTimeout(
							activityTimeoutsRef.current,
							clearActiveStatement
						);
						setActiveStatementHashes((current) => {
							if (!current.has(statement.statementHash)) return current;
							const next = new Set(current);
							next.delete(statement.statementHash);
							return next;
						});
					}, activeStatementLifetimeMs);
					activityTimeoutsRef.current.push(clearActiveStatement);
				}, delayMs);
				animationTimeoutsRef.current.push(timeout);
			}
		},
		[
			activeWavesRef,
			activityTimeoutsRef,
			animatedStatementHashesRef,
			animationTimeoutsRef,
			animationsEnabledRef,
			nextWaveIndexRef,
			nodeActivityRef,
			nodesByIdRef,
			refreshGraphVisuals,
			scheduleWaveAnimation,
			setActiveStatementHashes,
			threeRef,
			wavePoolRef
		]
	);

	const completeLedgerPlayback = useCallback(
		(slotIndex: string): void => {
			const activeLedger = activeLedgerRef.current;
			if (
				!animationsEnabledRef.current ||
				activeLedger?.slotIndex !== slotIndex
			) {
				return;
			}
			markSlotCompleted(activeLedger);
			activeLedgerRef.current = null;
			pausedPlaybackElapsedMsRef.current = null;
			setActivePlaybackSlotIndex(null);
			clearAnimationEffects();
			scheduleWaveAnimation();
		},
		[
			animationsEnabledRef,
			clearAnimationEffects,
			markSlotCompleted,
			scheduleWaveAnimation,
			setActivePlaybackSlotIndex
		]
	);

	const schedulePlaybackFinish = useCallback(
		(ledger: LedgerPlaybackFrame, elapsedMs: number): void => {
			clearPlaybackFinishTimeout();
			const remainingMs = Math.max(
				0,
				(ledger.playbackDurationMs ?? ledgerPlaybackDurationMs) - elapsedMs
			);
			if (remainingMs === 0) {
				completeLedgerPlayback(ledger.slotIndex);
				return;
			}
			playbackFinishTimeoutRef.current = window.setTimeout(() => {
				playbackFinishTimeoutRef.current = null;
				completeLedgerPlayback(ledger.slotIndex);
			}, remainingMs);
		},
		[clearPlaybackFinishTimeout, completeLedgerPlayback]
	);

	const startLedgerPlayback = useCallback(
		(ledger: LedgerPlaybackFrame): void => {
			clearAnimationEffects();
			activeLedgerRef.current = ledger;
			latestStartedSlotIndexRef.current = ledger.slotIndex;
			pausedPlaybackElapsedMsRef.current = null;
			setActivePlaybackSlotIndex(ledger.slotIndex);
			playbackStartedAtRef.current = performance.now();
			graphRef.current?.resumeAnimation();
			scheduleWaveAnimation();
			scheduleLedgerStatements(ledger);
			schedulePlaybackFinish(ledger, 0);
		},
		[
			clearAnimationEffects,
			graphRef,
			scheduleLedgerStatements,
			schedulePlaybackFinish,
			scheduleWaveAnimation,
			setActivePlaybackSlotIndex
		]
	);

	const advancePlayback = useCallback((): void => {
		if (
			!animationsEnabledRef.current ||
			!graphRef.current ||
			activeLedgerRef.current
		) {
			return;
		}

		const nextLedger = playbackQueueRef.current.shift();
		if (nextLedger) startLedgerPlayback(nextLedger);
	}, [animationsEnabledRef, graphRef, startLedgerPlayback]);

	const pausePlayback = useCallback((): void => {
		const activeLedger = activeLedgerRef.current;
		if (activeLedger) {
			pausedPlaybackElapsedMsRef.current = Math.min(
				activeLedger.playbackDurationMs ?? ledgerPlaybackDurationMs,
				Math.max(0, performance.now() - playbackStartedAtRef.current)
			);
		} else playbackQueueRef.current = [];
		clearPlaybackFinishTimeout();
		clearAnimationEffects(true);
	}, [clearAnimationEffects, clearPlaybackFinishTimeout]);

	const resumePlayback = useCallback((): void => {
		const activeLedger = activeLedgerRef.current;
		const elapsedMs = pausedPlaybackElapsedMsRef.current;
		if (!activeLedger || elapsedMs === null) return;
		playbackStartedAtRef.current = performance.now() - elapsedMs;
		pausedPlaybackElapsedMsRef.current = null;
		scheduleLedgerStatements(activeLedger);
		schedulePlaybackFinish(activeLedger, elapsedMs);
	}, [scheduleLedgerStatements, schedulePlaybackFinish]);

	useEffect(() => {
		advancePlaybackRef.current = advancePlayback;
	}, [advancePlayback]);

	useEffect(
		() => () => {
			clearPlaybackFinishTimeout();
			clearAnimationEffects();
		},
		[clearAnimationEffects, clearPlaybackFinishTimeout]
	);

	useEffect(() => {
		animationsEnabledRef.current = animationsEnabled;
		if (animationsEnabled) {
			graphRef.current?.resumeAnimation();
			resumePlayback();
			scheduleWaveAnimation();
			advancePlayback();
			return;
		}

		graphRef.current?.pauseAnimation();
		pausePlayback();
	}, [
		advancePlayback,
		animationsEnabled,
		animationsEnabledRef,
		graphRef,
		pausePlayback,
		resumePlayback,
		scheduleWaveAnimation
	]);

	useEffect(() => {
		const playableLedgers = playbackLedgers.filter(
			(ledger) => ledger.statements.length > 0
		);
		const activeLedger = activeLedgerRef.current;

		if (activeLedger) {
			const updatedActiveLedger = playableLedgers.find(
				(ledger) => ledger.slotIndex === activeLedger.slotIndex
			);
			if (updatedActiveLedger) {
				activeLedgerRef.current = updatedActiveLedger;
				if (animationsEnabled) scheduleLedgerStatements(updatedActiveLedger);
			}
		}

		if (!animationsEnabled) return;
		if (!playbackBoundarySlotIndex) {
			playbackQueueRef.current = [];
			return;
		}

		const queueResult = mergePlaybackQueue({
			activeSlotIndex: activeLedgerRef.current?.slotIndex ?? null,
			boundarySlotIndex: playbackBoundarySlotIndex,
			completedSignatures: completedSlotSignaturesRef.current,
			ledgers: playbackLedgers,
			minimumExclusiveSlotIndex: latestStartedSlotIndexRef.current
		});
		playbackQueueRef.current = queueResult.queue;
		advancePlayback();
	}, [
		advancePlayback,
		animationsEnabled,
		playbackBoundarySlotIndex,
		playbackLedgers,
		scheduleLedgerStatements
	]);

	return { clearAnimationEffects, scheduleWaveAnimation };
};
