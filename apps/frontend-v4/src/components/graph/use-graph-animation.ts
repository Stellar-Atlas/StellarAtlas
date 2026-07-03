import {
	useCallback,
	useEffect,
	type Dispatch,
	type RefObject,
	type SetStateAction
} from 'react';
import type { ForceGraph3DInstance } from '3d-force-graph';
import type { GraphVisualState } from './graph-visual-state';
import type { Graph3DNode } from './model-3d';
import type { GraphRenderData } from './use-graph-renderer';
import {
	getExistingFlowLinkKeys,
	getStatementColor,
	getStatementFlowPath,
	ledgerCloseAnimationBudgetMs,
	compareStatementsByObservation,
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

interface UseGraphAnimationOptions {
	activeWavesRef: RefObject<Map<number, ActiveWave>>;
	activityTimeoutsRef: RefObject<number[]>;
	animatedSlotStatements: readonly PublicScpStatementObservation[];
	animatedStatementHashesRef: RefObject<Set<string>>;
	animationTimeoutsRef: RefObject<number[]>;
	animationsEnabled: boolean;
	animationsEnabledRef: RefObject<boolean>;
	flowLinkColorsRef: RefObject<Map<string, string>>;
	graphDataRef: RefObject<GraphRenderData>;
	graphRef: RefObject<ForceGraph3DInstance | null>;
	latestSlotIndex: string | null;
	nextWaveIndexRef: RefObject<number>;
	nodeActivityRef: RefObject<Map<string, number>>;
	nodesByIdRef: RefObject<Map<string, Graph3DNode>>;
	refreshGraphVisuals: () => void;
	setActiveStatementHashes: Dispatch<SetStateAction<ReadonlySet<string>>>;
	threeRef: RefObject<typeof import('three') | null>;
	visualStateRef: RefObject<GraphVisualState>;
	waveAnimationFrameRef: RefObject<number | null>;
	wavePoolRef: RefObject<WaveMeshPool | null>;
}

interface UseGraphAnimationResult {
	clearAnimationEffects: () => void;
	scheduleWaveAnimation: () => void;
}

export const useGraphAnimation = ({
	activeWavesRef,
	activityTimeoutsRef,
	animatedSlotStatements,
	animatedStatementHashesRef,
	animationTimeoutsRef,
	animationsEnabled,
	animationsEnabledRef,
	flowLinkColorsRef,
	graphDataRef,
	graphRef,
	latestSlotIndex,
	nextWaveIndexRef,
	nodeActivityRef,
	nodesByIdRef,
	refreshGraphVisuals,
	setActiveStatementHashes,
	threeRef,
	waveAnimationFrameRef,
	wavePoolRef
}: UseGraphAnimationOptions): UseGraphAnimationResult => {
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

	useEffect(() => {
		clearAnimationEffects();
	}, [clearAnimationEffects, latestSlotIndex]);

	useEffect(
		() => () => {
			clearAnimationEffects();
		},
		[clearAnimationEffects]
	);

	useEffect(() => {
		animationsEnabledRef.current = animationsEnabled;
		if (animationsEnabled) {
			graphRef.current?.resumeAnimation();
			scheduleWaveAnimation();
			return;
		}

		graphRef.current?.pauseAnimation();
		clearAnimationEffects();
	}, [
		animationsEnabled,
		animationsEnabledRef,
		clearAnimationEffects,
		graphRef,
		scheduleWaveAnimation
	]);

	useEffect(() => {
		if (
			!animationsEnabled ||
			!graphRef.current ||
			animatedSlotStatements.length === 0
		) {
			return;
		}
		const unscheduledStatements = animatedSlotStatements
			.filter(
				(statement) =>
					!animatedStatementHashesRef.current.has(statement.statementHash)
			)
			.toSorted(compareStatementsByObservation);
		if (unscheduledStatements.length === 0) return;

		const observedTimes = animatedSlotStatements.map((statement) =>
			new Date(statement.observedAt).getTime()
		);
		const firstObservedAt = Math.min(...observedTimes);
		const lastObservedAt = Math.max(...observedTimes);
		const observedSpan = Math.max(1, lastObservedAt - firstObservedAt);

		for (const statement of unscheduledStatements) {
			animatedStatementHashesRef.current.add(statement.statementHash);
			const flowPath = getStatementFlowPath(
				statement,
				graphDataRef.current.links,
				nodesByIdRef.current
			);
			if (!flowPath) continue;
			const observedAt = new Date(statement.observedAt).getTime();
			const normalizedDelay = (observedAt - firstObservedAt) / observedSpan;
			const delayMs = Math.max(
				0,
				Math.min(
					ledgerCloseAnimationBudgetMs - 120,
					Math.floor(normalizedDelay * ledgerCloseAnimationBudgetMs)
				)
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
	}, [
		activateFlowPath,
		activityTimeoutsRef,
		animatedSlotStatements,
		animatedStatementHashesRef,
		animateStatementPacket,
		animationTimeoutsRef,
		animationsEnabled,
		graphDataRef,
		graphRef,
		nodesByIdRef,
		setActiveStatementHashes
	]);

	return { clearAnimationEffects, scheduleWaveAnimation };
};
