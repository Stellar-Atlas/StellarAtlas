import { useCallback, useEffect, useRef, type Dispatch, type RefObject, type SetStateAction } from 'react';
import type { ForceGraph3DInstance } from '3d-force-graph';
import type { GraphVisualState } from './graph-visual-state';
import type { Graph3DNode } from './model-3d';
import type { GraphRenderData } from './use-graph-renderer';
import {
	getExistingFlowLinkKeys,
	getStatementColor,
	getStatementFlowPath,
	ledgerCloseAnimationBudgetMs,
	ledgerPlaybackDurationMs,
	compareStatementsByObservation,
	type LedgerPlaybackFrame,
	type StatementFlowPath
} from './scp-flow-paths';
import {
	hideAllWaveSlots,
	maxWaveInstances,
	setWaveSlotColor,
	updateWaveMeshPool,
	type ActiveWave,
	type WaveMeshPool
} from './graph-wave-animation';
import type { PublicScpStatementObservation } from '../../api/types';
import { compareLedgerSequences } from '../../domain/ledger-sequence';

interface UseGraphAnimationOptions {
	activeWavesRef: RefObject<Map<number, ActiveWave>>;
	activityTimeoutsRef: RefObject<number[]>;
	animatedStatementHashesRef: RefObject<Set<string>>;
	animationTimeoutsRef: RefObject<number[]>;
	animationsEnabled: boolean;
	animationsEnabledRef: RefObject<boolean>;
	flowLinkColorsRef: RefObject<Map<string, string>>;
	graphDataRef: RefObject<GraphRenderData>;
	graphRef: RefObject<ForceGraph3DInstance | null>;
	nextWaveIndexRef: RefObject<number>;
	nodeActivityRef: RefObject<Map<string, number>>;
	nodesByIdRef: RefObject<Map<string, Graph3DNode>>;
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
	flowLinkColorsRef,
	graphDataRef,
	graphRef,
	nextWaveIndexRef,
	nodeActivityRef,
	nodesByIdRef,
	playbackLedgers,
	refreshGraphVisuals,
	setActivePlaybackSlotIndex,
	setActiveStatementHashes,
	threeRef,
	waveAnimationFrameRef,
	wavePoolRef
}: UseGraphAnimationOptions): { clearAnimationEffects: () => void; scheduleWaveAnimation: () => void } => {
	const activeLedgerRef = useRef<LedgerPlaybackFrame | null>(null);
	const playbackQueueRef = useRef<LedgerPlaybackFrame[]>([]);
	const playbackStartedAtRef = useRef(0);
	const playbackFinishTimeoutRef = useRef<number | null>(null);
	const completedSlotIndexesRef = useRef<Set<string>>(new Set());
	const completedSlotOrderRef = useRef<string[]>([]);
	const advancePlaybackRef = useRef<() => void>(() => undefined);

	const activateFlowPath = useCallback(
		(path: StatementFlowPath): void => {
			const graph = graphRef.current;
			if (!graph) return;
			const color = getStatementColor(path.statement.statementType);

			for (const key of getExistingFlowLinkKeys(
				path,
				graphDataRef.current.links
			)) {
				flowLinkColorsRef.current.set(key, color);
				const timeout = window.setTimeout(() => {
					if (flowLinkColorsRef.current.get(key) === color) {
						flowLinkColorsRef.current.delete(key);
						graph.refresh();
					}
				}, 1_250);
				activityTimeoutsRef.current.push(timeout);
			}

			for (const nodeId of [path.source.id, path.target.id]) {
				nodeActivityRef.current.set(
					nodeId,
					Math.min(1, (nodeActivityRef.current.get(nodeId) ?? 0) + 0.38)
				);
				const timeout = window.setTimeout(() => {
					const nextWeight = Math.max(
						0,
						(nodeActivityRef.current.get(nodeId) ?? 0) - 0.38
					);
					if (nextWeight === 0) nodeActivityRef.current.delete(nodeId);
					else nodeActivityRef.current.set(nodeId, nextWeight);
					refreshGraphVisuals();
				}, 1_650);
				activityTimeoutsRef.current.push(timeout);
			}

			refreshGraphVisuals();
		},
		[
			activityTimeoutsRef,
			flowLinkColorsRef,
			graphDataRef,
			graphRef,
			nodeActivityRef,
			refreshGraphVisuals
		]
	);

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

	const animateStatementPacket = useCallback(
		(
			statement: PublicScpStatementObservation,
			path: StatementFlowPath
		): void => {
			const THREE = threeRef.current;
			const wavePool = wavePoolRef.current;
			if (!THREE || !wavePool) return;

			const color = getStatementColor(statement.statementType);
			const source = new THREE.Vector3(
				path.source.x ?? 0,
				path.source.y ?? 0,
				path.source.z ?? 0
			);
			const target = new THREE.Vector3(
				path.target.x ?? 0,
				path.target.y ?? 0,
				path.target.z ?? 0
			);
			const midpoint = new THREE.Vector3()
				.addVectors(source, target)
				.multiplyScalar(0.5);
			const distance = source.distanceTo(target);
			const lift = Math.min(90, Math.max(22, distance * 0.08));
			midpoint.y += lift;

			const durationMs =
				statement.statementType === 'nominate'
					? 1_020
					: statement.statementType === 'prepare'
						? 880
						: 760;
			const index = nextWaveIndexRef.current % maxWaveInstances;
			nextWaveIndexRef.current += 1;
			setWaveSlotColor(wavePool, index, color);
			activeWavesRef.current.set(index, {
				durationMs,
				index,
				midpoint,
				source,
				startedAt: performance.now(),
				target
			});
			scheduleWaveAnimation();
		},
		[
			activeWavesRef,
			nextWaveIndexRef,
			scheduleWaveAnimation,
			threeRef,
			wavePoolRef
		]
	);

	const clearAnimationEffects = useCallback((): void => {
		for (const timeout of animationTimeoutsRef.current) {
			window.clearTimeout(timeout);
		}
		for (const timeout of activityTimeoutsRef.current) {
			window.clearTimeout(timeout);
		}
		animationTimeoutsRef.current = [];
		activityTimeoutsRef.current = [];
		animatedStatementHashesRef.current = new Set();
		setActiveStatementHashes(new Set<string>());
		flowLinkColorsRef.current = new Map();
		nodeActivityRef.current = new Map();
		activeWavesRef.current.clear();
		if (waveAnimationFrameRef.current !== null) {
			window.cancelAnimationFrame(waveAnimationFrameRef.current);
			waveAnimationFrameRef.current = null;
		}

		if (wavePoolRef.current) hideAllWaveSlots(wavePoolRef.current);
		refreshGraphVisuals();
	}, [
		activeWavesRef,
		activityTimeoutsRef,
		animatedStatementHashesRef,
		animationTimeoutsRef,
		flowLinkColorsRef,
		nodeActivityRef,
		refreshGraphVisuals,
		setActiveStatementHashes,
		waveAnimationFrameRef,
		wavePoolRef
	]);

	const clearPlaybackFinishTimeout = useCallback((): void => {
		if (playbackFinishTimeoutRef.current === null) return;
		window.clearTimeout(playbackFinishTimeoutRef.current);
		playbackFinishTimeoutRef.current = null;
	}, []);

	const markSlotCompleted = useCallback((slotIndex: string): void => {
		if (completedSlotIndexesRef.current.has(slotIndex)) return;
		completedSlotIndexesRef.current.add(slotIndex);
		completedSlotOrderRef.current.push(slotIndex);

		while (completedSlotOrderRef.current.length > 32) {
			const expiredSlotIndex = completedSlotOrderRef.current.shift();
			if (expiredSlotIndex)
				completedSlotIndexesRef.current.delete(expiredSlotIndex);
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
			const animationBudgetMs =
				ledger.animationBudgetMs ?? ledgerCloseAnimationBudgetMs;
			const playbackDurationMs =
				ledger.playbackDurationMs ?? ledgerPlaybackDurationMs;
			const latestLaunchMs = playbackDurationMs - 1_700;
			if (elapsedMs > latestLaunchMs) return;

			const unscheduledStatements = ledger.statements
				.filter(
					(statement) =>
						!animatedStatementHashesRef.current.has(statement.statementHash)
				)
				.toSorted(compareStatementsByObservation);
			if (unscheduledStatements.length === 0) return;

			const observedTimes = ledger.statements
				.map((statement) => new Date(statement.observedAt).getTime())
				.filter(Number.isFinite);
			const firstObservedAt =
				observedTimes.length > 0 ? Math.min(...observedTimes) : 0;
			const lastObservedAt =
				observedTimes.length > 0 ? Math.max(...observedTimes) : 1;
			const observedSpan = Math.max(1, lastObservedAt - firstObservedAt);

			for (const statement of unscheduledStatements) {
				const flowPath = getStatementFlowPath(
					statement,
					graphDataRef.current.links,
					nodesByIdRef.current
				);
				if (!flowPath) continue;

				animatedStatementHashesRef.current.add(statement.statementHash);
				const observedAt = new Date(statement.observedAt).getTime();
				const normalizedDelay = Number.isFinite(observedAt)
					? (observedAt - firstObservedAt) / observedSpan
					: 0;
				const targetDelayMs = Math.max(
					0,
						Math.min(
						animationBudgetMs,
						Math.floor(normalizedDelay * animationBudgetMs)
					)
				);
				const delayMs = Math.max(
					0,
					Math.min(targetDelayMs - elapsedMs, latestLaunchMs - elapsedMs)
				);
				const timeout = window.setTimeout(() => {
					activateFlowPath(flowPath);
					animateStatementPacket(statement, flowPath);
					setActiveStatementHashes((current) => {
						const next = new Set(current);
						next.add(statement.statementHash);
						return next;
					});
					const clearActiveStatement = window.setTimeout(() => {
						setActiveStatementHashes((current) => {
							if (!current.has(statement.statementHash)) return current;
							const next = new Set(current);
							next.delete(statement.statementHash);
							return next;
						});
					}, 1_700);
					activityTimeoutsRef.current.push(clearActiveStatement);
				}, delayMs);
				animationTimeoutsRef.current.push(timeout);
			}
		},
		[
			activateFlowPath,
			activityTimeoutsRef,
			animatedStatementHashesRef,
			animateStatementPacket,
			animationTimeoutsRef,
			animationsEnabledRef,
			graphDataRef,
			graphRef,
			nodesByIdRef,
			setActiveStatementHashes
		]
	);

	const startLedgerPlayback = useCallback(
		(ledger: LedgerPlaybackFrame): void => {
			clearPlaybackFinishTimeout();
			clearAnimationEffects();
			activeLedgerRef.current = ledger;
			setActivePlaybackSlotIndex(ledger.slotIndex);
			playbackStartedAtRef.current = performance.now();
			graphRef.current?.resumeAnimation();
			scheduleWaveAnimation();
			scheduleLedgerStatements(ledger);
			playbackFinishTimeoutRef.current = window.setTimeout(() => {
				const activeLedger = activeLedgerRef.current;
				if (activeLedger) markSlotCompleted(activeLedger.slotIndex);
				activeLedgerRef.current = null;
				setActivePlaybackSlotIndex(null);
				clearAnimationEffects();
				scheduleWaveAnimation();
				advancePlaybackRef.current();
			}, ledger.playbackDurationMs ?? ledgerPlaybackDurationMs);
		},
		[
			clearAnimationEffects,
			clearPlaybackFinishTimeout,
			graphRef,
			markSlotCompleted,
			scheduleLedgerStatements,
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
			scheduleWaveAnimation();
			advancePlayback();
			return;
		}

		graphRef.current?.pauseAnimation();
		clearPlaybackFinishTimeout();
		activeLedgerRef.current = null;
		setActivePlaybackSlotIndex(null);
		playbackQueueRef.current = [];
		clearAnimationEffects();
	}, [
		advancePlayback,
		animationsEnabled,
		animationsEnabledRef,
		clearAnimationEffects,
		clearPlaybackFinishTimeout,
		graphRef,
		scheduleWaveAnimation,
		setActivePlaybackSlotIndex
	]);

	useEffect(() => {
		const orderedLedgers = playbackLedgers
			.toSorted((left, right) =>
				compareLedgerSequences(left.slotIndex, right.slotIndex)
			);
		const latestLedger = orderedLedgers.at(-1);
		const playableLedgers = orderedLedgers.filter(
			(ledger) => ledger.statements.length > 0
		);
		const activeLedger = activeLedgerRef.current;

		if (activeLedger) {
			const updatedActiveLedger = playableLedgers.find(
				(ledger) => ledger.slotIndex === activeLedger.slotIndex
			);
			if (updatedActiveLedger) {
				activeLedgerRef.current = updatedActiveLedger;
				scheduleLedgerStatements(updatedActiveLedger);
			}
		}

		if (!animationsEnabled || !latestLedger) {
			playbackQueueRef.current = [];
			return;
		}

		const eligibleLedgers = playableLedgers
			.filter(
				(ledger) =>
					compareLedgerSequences(ledger.slotIndex, latestLedger.slotIndex) < 0 &&
					!completedSlotIndexesRef.current.has(ledger.slotIndex) &&
					activeLedgerRef.current?.slotIndex !== ledger.slotIndex
			)
			.slice(-2);

		playbackQueueRef.current = eligibleLedgers;
		advancePlayback();
	}, [
		advancePlayback,
		animationsEnabled,
		playbackLedgers,
		scheduleLedgerStatements
	]);

	return { clearAnimationEffects, scheduleWaveAnimation };
};
