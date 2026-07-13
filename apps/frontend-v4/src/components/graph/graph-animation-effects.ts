import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { PublicScpGraphStatement } from '../../api/types';
import {
	getStatementColor,
	ledgerCloseAnimationBudgetMs,
	ledgerPlaybackDurationMs,
	type LedgerPlaybackFrame,
	type StatementFlowPath
} from './scp-flow-paths';
import {
	hideAllWaveSlots,
	launchWaveSlot,
	maxWaveInstances,
	type ActiveWave,
	type WaveMeshPool
} from './graph-wave-animation';

export const activeStatementLifetimeMs = 1_700;

export const getStatementLaunchDeadlineMs = (
	ledger: LedgerPlaybackFrame
): number =>
	Math.max(
		0,
		Math.min(
			ledger.animationBudgetMs ?? ledgerCloseAnimationBudgetMs,
			(ledger.playbackDurationMs ?? ledgerPlaybackDurationMs) -
				activeStatementLifetimeMs
		)
	);

export const removeTrackedTimeout = (
	timeouts: number[],
	timeout: number
): void => {
	const index = timeouts.indexOf(timeout);
	if (index >= 0) timeouts.splice(index, 1);
};

interface ActivateStatementFlowPathOptions {
	activityTimeoutsRef: RefObject<number[]>;
	nodeActivityRef: RefObject<Map<string, number>>;
	path: StatementFlowPath;
	refreshGraphVisuals: () => void;
}

export const activateStatementFlowPath = ({
	activityTimeoutsRef,
	nodeActivityRef,
	path,
	refreshGraphVisuals
}: ActivateStatementFlowPathOptions): void => {
	const activeNodeIds = new Set([
		path.source.id,
		path.target.id,
		...(path.observedPeer ? [path.observedPeer.id] : [])
	]);
	for (const nodeId of activeNodeIds) {
		nodeActivityRef.current.set(
			nodeId,
			(nodeActivityRef.current.get(nodeId) ?? 0) + 0.38
		);
		let timeout = 0;
		timeout = window.setTimeout(() => {
			removeTrackedTimeout(activityTimeoutsRef.current, timeout);
			const nextWeight = Math.max(
				0,
				(nodeActivityRef.current.get(nodeId) ?? 0) - 0.38
			);
			if (nextWeight < 0.001) nodeActivityRef.current.delete(nodeId);
			else nodeActivityRef.current.set(nodeId, nextWeight);
			refreshGraphVisuals();
		}, 1_650);
		activityTimeoutsRef.current.push(timeout);
	}

	refreshGraphVisuals();
};

interface AnimateStatementPacketOptions {
	activeWavesRef: RefObject<Map<number, ActiveWave>>;
	nextWaveIndexRef: RefObject<number>;
	path: StatementFlowPath;
	scheduleWaveAnimation: () => void;
	statement: PublicScpGraphStatement;
	threeRef: RefObject<typeof import('three') | null>;
	wavePoolRef: RefObject<WaveMeshPool | null>;
}

export const animateStatementPacket = ({
	activeWavesRef,
	nextWaveIndexRef,
	path,
	scheduleWaveAnimation,
	statement,
	threeRef,
	wavePoolRef
}: AnimateStatementPacketOptions): void => {
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
	midpoint.y += Math.min(90, Math.max(22, distance * 0.08));

	const durationMs =
		statement.statementType === 'nominate'
			? 1_020
			: statement.statementType === 'prepare'
				? 880
				: 760;
	const index = nextWaveIndexRef.current % maxWaveInstances;
	nextWaveIndexRef.current += 1;
	const startedAt = performance.now();
	launchWaveSlot(wavePool, index, {
		color,
		durationMs,
		midpoint,
		source,
		startedAt,
		target
	});
	activeWavesRef.current.set(index, { durationMs, index, startedAt });
	scheduleWaveAnimation();
};

interface ClearGraphAnimationEffectsOptions {
	activeWavesRef: RefObject<Map<number, ActiveWave>>;
	activityTimeoutsRef: RefObject<number[]>;
	animatedStatementHashesRef: RefObject<Set<string>>;
	animationTimeoutsRef: RefObject<number[]>;
	nodeActivityRef: RefObject<Map<string, number>>;
	pendingStatementHashes: Set<string>;
	preserveAnimatedStatements: boolean;
	refreshGraphVisuals: () => void;
	setActiveStatementHashes: Dispatch<SetStateAction<ReadonlySet<string>>>;
	waveAnimationFrameRef: RefObject<number | null>;
	wavePoolRef: RefObject<WaveMeshPool | null>;
}

export const clearGraphAnimationEffects = ({
	activeWavesRef,
	activityTimeoutsRef,
	animatedStatementHashesRef,
	animationTimeoutsRef,
	nodeActivityRef,
	pendingStatementHashes,
	preserveAnimatedStatements,
	refreshGraphVisuals,
	setActiveStatementHashes,
	waveAnimationFrameRef,
	wavePoolRef
}: ClearGraphAnimationEffectsOptions): void => {
	for (const timeout of animationTimeoutsRef.current) {
		window.clearTimeout(timeout);
	}
	for (const timeout of activityTimeoutsRef.current) {
		window.clearTimeout(timeout);
	}
	animationTimeoutsRef.current = [];
	activityTimeoutsRef.current = [];
	if (preserveAnimatedStatements) {
		for (const statementHash of pendingStatementHashes) {
			animatedStatementHashesRef.current.delete(statementHash);
		}
	} else {
		animatedStatementHashesRef.current = new Set();
	}
	pendingStatementHashes.clear();
	setActiveStatementHashes(new Set<string>());
	nodeActivityRef.current = new Map();
	activeWavesRef.current.clear();
	if (waveAnimationFrameRef.current !== null) {
		window.cancelAnimationFrame(waveAnimationFrameRef.current);
		waveAnimationFrameRef.current = null;
	}
	if (wavePoolRef.current) hideAllWaveSlots(wavePoolRef.current);
	refreshGraphVisuals();
};
