'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ForceGraph3DInstance } from '3d-force-graph';
import type {
	Color,
	CanvasTexture,
	Group as ThreeGroup,
	InstancedMesh,
	MeshBasicMaterial,
	Object3D,
	PlaneGeometry,
	Vector3
} from 'three';
import Link from 'next/link';
import type {
	PublicHistoryArchiveScanLogEntry,
	PublicNetwork,
	PublicScpStatementObservation
} from '../../api/types';
import {
	buildBrowserApiUrl,
	fetchBrowserHistoryArchiveScanLogs,
	fetchBrowserLatestLedger,
	fetchBrowserPublicNetwork,
	fetchBrowserScpStatements
} from '../../api/browser-client';
import {
	publishLatestLedger,
	subscribeToLatestLedger
} from '../../api/latest-ledger-events';
import {
	buildGraph3DModel,
	type Graph3DNode,
	type Graph3DLink,
	type Graph3DOrganization
} from './model-3d';
import { ScpAnalysisPanel } from './scp-analysis-panel';
import { getNodeLabel, getNodeTags } from '../../domain/network';
import { formatInteger, formatPercent } from '../../format/formatters';
import { StatusTags } from '../status-tags';
import {
	GraphContextMenu,
	type GraphContextMenuState
} from './graph-context-menu';
import {
	createGraphNodeObject,
	getGraphLinkColor,
	getGraphLinkWidth
} from './graph-node-object';
import { buildQuorumRows, collectQuorumValidatorIds } from './graph-quorum';
import {
	defaultGraphVisualState,
	type GraphVisualState
} from './graph-visual-state';
import { getStatementValueHash, ScpLiveFeed } from './scp-live-feed';
import {
	getArchiveVerificationErrors,
	getWorkerIssues,
	scanLogHasArchiveVerificationError
} from '../../domain/history-archive';

interface GraphExplorerProps {
	network: PublicNetwork;
	scpStatements: PublicScpStatementObservation[];
}

const getCameraTarget = (node: Graph3DNode): { x: number; y: number; z: number } => ({
	x: (node.x ?? 0) * 1.45,
	y: (node.y ?? 0) * 1.45,
	z: (node.z ?? 0) * 1.45 + 120
});

const initialCameraPosition = { x: 0, y: -80, z: 940 };
const initialCameraTarget = { x: 0, y: 0, z: 0 };
const networkRefreshIntervalMs = 10_000;
const scpRefreshIntervalMs = 1_200;
const latestLedgerRefreshIntervalMs = 2_000;
const liveNetworkPath = '/v1/live';
const liveScpStatementPath = '/v1/scp-statements/live';
const maxAnimatedStatementsPerLedger = 48;
const maxWaveInstances = maxAnimatedStatementsPerLedger;
const maxActiveFeedStatements = 8;
const ledgerCloseAnimationBudgetMs = 4_500;

const formatAvailability = (hasStats: boolean, value: number): string =>
	hasStats ? formatPercent(value) : 'Collecting';

const formatNullableInteger = (value: number | null): string =>
	value === null ? 'Unknown' : formatInteger(value);

const formatLag = (value: number | null): string =>
	value === null ? 'Unknown' : value === 0 ? '0 ms reported' : `${formatInteger(value)} ms`;

const formatShortDateTime = (value: string): string =>
	new Intl.DateTimeFormat('en-US', {
		dateStyle: 'medium',
		timeStyle: 'short'
	}).format(new Date(value));

const formatDuration = (durationMs: number): string => {
	if (durationMs < 1000) return `${formatInteger(durationMs)} ms`;
	const seconds = Math.round(durationMs / 1000);
	if (seconds < 90) return `${formatInteger(seconds)}s`;
	return `${formatInteger(Math.round(seconds / 60))}m`;
};

type GraphLinkEndpoint =
	| Graph3DNode
	| number
	| string
	| { id?: number | string }
	| undefined;

interface GraphLinkLike {
	label?: string;
	source?: GraphLinkEndpoint;
	target?: GraphLinkEndpoint;
}

interface StatementFlowPath {
	label: string;
	statement: PublicScpStatementObservation;
	source: Graph3DNode;
	target: Graph3DNode;
}

interface WaveMeshPool {
	back: InstancedMesh<PlaneGeometry, MeshBasicMaterial>;
	color: Color;
	dummy: Object3D;
	forwardAxis: Vector3;
	front: InstancedMesh<PlaneGeometry, MeshBasicMaterial>;
	tangent: Vector3;
	texture: CanvasTexture;
}

interface ActiveWave {
	durationMs: number;
	index: number;
	midpoint: Vector3;
	source: Vector3;
	startedAt: number;
	target: Vector3;
}

const hideWaveSlot = (pool: WaveMeshPool, index: number): void => {
	pool.dummy.position.set(0, 0, 0);
	pool.dummy.quaternion.identity();
	pool.dummy.scale.setScalar(0);
	pool.dummy.updateMatrix();
	pool.front.setMatrixAt(index, pool.dummy.matrix);
	pool.back.setMatrixAt(index, pool.dummy.matrix);
};

const setWaveSlotColor = (
	pool: WaveMeshPool,
	index: number,
	color: string
): void => {
	pool.color.set(color);
	pool.front.setColorAt(index, pool.color);
	pool.back.setColorAt(index, pool.color);
	if (pool.front.instanceColor) pool.front.instanceColor.needsUpdate = true;
	if (pool.back.instanceColor) pool.back.instanceColor.needsUpdate = true;
};

const createWaveTexture = (THREE: typeof import('three')): CanvasTexture => {
	const canvas = document.createElement('canvas');
	canvas.width = 256;
	canvas.height = 64;
	const context = canvas.getContext('2d');
	if (!context) return new THREE.CanvasTexture(canvas);

	context.clearRect(0, 0, canvas.width, canvas.height);
	const gradient = context.createLinearGradient(0, 0, canvas.width, 0);
	gradient.addColorStop(0, 'rgba(255,255,255,0)');
	gradient.addColorStop(0.18, 'rgba(255,255,255,0.16)');
	gradient.addColorStop(0.52, 'rgba(255,255,255,1)');
	gradient.addColorStop(0.82, 'rgba(255,255,255,0.24)');
	gradient.addColorStop(1, 'rgba(255,255,255,0)');
	context.strokeStyle = gradient;
	context.lineCap = 'round';
	context.lineJoin = 'round';

	for (const [offsetY, width, amplitude] of [
		[28, 6, 8],
		[34, 3.5, 5],
		[22, 2.2, 4]
	] as const) {
		context.beginPath();
		context.lineWidth = width;
		for (let x = 0; x <= canvas.width; x += 8) {
			const y =
				offsetY +
				Math.sin((x / canvas.width) * Math.PI * 5) * amplitude;
			if (x === 0) context.moveTo(x, y);
			else context.lineTo(x, y);
		}
		context.stroke();
	}

	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.needsUpdate = true;
	return texture;
};

const createWaveMeshPool = (
	THREE: typeof import('three'),
	packetGroup: ThreeGroup
): WaveMeshPool => {
	const texture = createWaveTexture(THREE);
	const frontGeometry = new THREE.PlaneGeometry(54, 16, 1, 1);
	const backGeometry = new THREE.PlaneGeometry(82, 26, 1, 1);
	const frontMaterial = new THREE.MeshBasicMaterial({
		alphaMap: texture,
		blending: THREE.AdditiveBlending,
		color: 0xffffff,
		depthWrite: false,
		map: texture,
		opacity: 0.9,
		transparent: true,
		vertexColors: true
	});
	const backMaterial = new THREE.MeshBasicMaterial({
		alphaMap: texture,
		blending: THREE.AdditiveBlending,
		color: 0xffffff,
		depthWrite: false,
		map: texture,
		opacity: 0.52,
		transparent: true,
		vertexColors: true
	});
	const front = new THREE.InstancedMesh(
		frontGeometry,
		frontMaterial,
		maxWaveInstances
	);
	const back = new THREE.InstancedMesh(
		backGeometry,
		backMaterial,
		maxWaveInstances
	);
	front.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
	back.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
	front.frustumCulled = false;
	back.frustumCulled = false;

	const pool: WaveMeshPool = {
		back,
		color: new THREE.Color('#58a6ff'),
		dummy: new THREE.Object3D(),
		forwardAxis: new THREE.Vector3(1, 0, 0),
		front,
		tangent: new THREE.Vector3(1, 0, 0),
		texture
	};

	for (let index = 0; index < maxWaveInstances; index += 1) {
		hideWaveSlot(pool, index);
		setWaveSlotColor(pool, index, '#58a6ff');
	}
	front.instanceMatrix.needsUpdate = true;
	back.instanceMatrix.needsUpdate = true;

	packetGroup.add(back);
	packetGroup.add(front);
	return pool;
};

const disposeWaveMeshPool = (pool: WaveMeshPool): void => {
	pool.front.geometry.dispose();
	pool.front.material.dispose();
	pool.back.geometry.dispose();
	pool.back.material.dispose();
	pool.texture.dispose();
};

const hideAllWaveSlots = (pool: WaveMeshPool): void => {
	for (let index = 0; index < maxWaveInstances; index += 1) {
		hideWaveSlot(pool, index);
	}
	pool.front.instanceMatrix.needsUpdate = true;
	pool.back.instanceMatrix.needsUpdate = true;
};

const updateWaveMeshPool = (
	pool: WaveMeshPool,
	activeWaves: Map<number, ActiveWave>,
	now: number
): void => {
	for (const [index, wave] of activeWaves) {
		const linearProgress = Math.min(1, (now - wave.startedAt) / wave.durationMs);
		if (linearProgress >= 1) {
			hideWaveSlot(pool, index);
			activeWaves.delete(index);
			continue;
		}

		const progress = 1 - Math.pow(1 - linearProgress, 3);
		const inverse = 1 - progress;
		const x =
			inverse * inverse * wave.source.x +
			2 * inverse * progress * wave.midpoint.x +
			progress * progress * wave.target.x;
		const y =
			inverse * inverse * wave.source.y +
			2 * inverse * progress * wave.midpoint.y +
			progress * progress * wave.target.y;
		const z =
			inverse * inverse * wave.source.z +
			2 * inverse * progress * wave.midpoint.z +
			progress * progress * wave.target.z;
		const fade =
			linearProgress > 0.78
				? Math.max(0, (1 - linearProgress) / 0.22)
				: 1;
		const pulseScale = (0.75 + Math.sin(progress * Math.PI) * 0.68) * fade;

		pool.tangent
			.set(
				2 * inverse * (wave.midpoint.x - wave.source.x) +
					2 * progress * (wave.target.x - wave.midpoint.x),
				2 * inverse * (wave.midpoint.y - wave.source.y) +
					2 * progress * (wave.target.y - wave.midpoint.y),
				2 * inverse * (wave.midpoint.z - wave.source.z) +
					2 * progress * (wave.target.z - wave.midpoint.z)
			)
			.normalize();
		pool.dummy.position.set(x, y, z);
		pool.dummy.quaternion.setFromUnitVectors(
			pool.forwardAxis,
			pool.tangent
		);
		pool.dummy.scale.setScalar(pulseScale);
		pool.dummy.updateMatrix();
		pool.front.setMatrixAt(index, pool.dummy.matrix);
		pool.dummy.scale.setScalar(pulseScale * 1.62);
		pool.dummy.updateMatrix();
		pool.back.setMatrixAt(index, pool.dummy.matrix);
	}

	pool.front.instanceMatrix.needsUpdate = true;
	pool.back.instanceMatrix.needsUpdate = true;
};

const getEndpointId = (endpoint: GraphLinkEndpoint): string | null => {
	if (endpoint === undefined) return null;
	if (typeof endpoint === 'string') return endpoint;
	if (typeof endpoint === 'number') return endpoint.toString();
	if (endpoint.id === undefined) return null;
	return endpoint.id.toString();
};

const getGraphLinkKey = (link: GraphLinkLike): string => {
	const sourceId = getEndpointId(link.source) ?? '';
	const targetId = getEndpointId(link.target) ?? '';
	return `${sourceId}->${targetId}`;
};

const getStatementColor = (
	statementType: PublicScpStatementObservation['statementType']
): string => {
	if (statementType === 'nominate') return '#f7cf4d';
	if (statementType === 'prepare') return '#58a6ff';
	if (statementType === 'confirm') return '#5dd39e';
	return '#c084fc';
};

const compareStatementsByObservation = (
	left: PublicScpStatementObservation,
	right: PublicScpStatementObservation
): number =>
	new Date(left.observedAt).getTime() - new Date(right.observedAt).getTime() ||
	left.statementHash.localeCompare(right.statementHash);

const addStatementIfNew = (
	selectedStatements: PublicScpStatementObservation[],
	selectedHashes: Set<string>,
	statement: PublicScpStatementObservation | undefined
): void => {
	if (!statement || selectedHashes.has(statement.statementHash)) return;
	if (selectedStatements.length >= maxAnimatedStatementsPerLedger) return;
	selectedHashes.add(statement.statementHash);
	selectedStatements.push(statement);
};

const selectLedgerAnimationStatements = (
	statements: readonly PublicScpStatementObservation[],
	nodesById: ReadonlyMap<string, Graph3DNode>
): readonly PublicScpStatementObservation[] => {
	const chronologicalStatements = statements.toSorted(compareStatementsByObservation);
	if (chronologicalStatements.length <= maxAnimatedStatementsPerLedger)
		return chronologicalStatements;

	const statementsByOrganization = new Map<string, PublicScpStatementObservation[]>();
	for (const statement of chronologicalStatements) {
		const organizationId = nodesById.get(statement.nodeId)?.groupId ?? statement.nodeId;
		statementsByOrganization.set(organizationId, [
			...(statementsByOrganization.get(organizationId) ?? []),
			statement
		]);
	}

	const selectedStatements: PublicScpStatementObservation[] = [];
	const selectedHashes = new Set<string>();

	const earliestByOrganization = Array.from(statementsByOrganization.values())
		.map((organizationStatements) => organizationStatements[0])
		.filter(
			(
				statement
			): statement is PublicScpStatementObservation =>
				statement !== undefined
		)
		.toSorted(compareStatementsByObservation);

	for (const statement of earliestByOrganization)
		addStatementIfNew(selectedStatements, selectedHashes, statement);

	for (let index = 0; index < maxAnimatedStatementsPerLedger; index += 1) {
		const sourceIndex = Math.round(
			(index * (chronologicalStatements.length - 1)) /
				(maxAnimatedStatementsPerLedger - 1)
		);
		addStatementIfNew(
			selectedStatements,
			selectedHashes,
			chronologicalStatements[sourceIndex]
		);
	}

	let queueOffset = 0;
	const organizationQueues = Array.from(statementsByOrganization.values());
	while (
		selectedStatements.length < maxAnimatedStatementsPerLedger &&
		queueOffset < chronologicalStatements.length
	) {
		const nextStatements = organizationQueues
			.map((organizationStatements) => organizationStatements[queueOffset])
			.filter(
				(
					statement
				): statement is PublicScpStatementObservation =>
					statement !== undefined
			)
			.toSorted(compareStatementsByObservation);

		for (const statement of nextStatements)
			addStatementIfNew(selectedStatements, selectedHashes, statement);

		queueOffset += 1;
	}

	return selectedStatements.toSorted(compareStatementsByObservation);
};

const getLatestSlotIndex = (
	statements: readonly PublicScpStatementObservation[]
): string | null =>
	statements.reduce<string | null>((latest, statement) => {
		if (latest === null) return statement.slotIndex;
		return BigInt(statement.slotIndex) > BigInt(latest)
			? statement.slotIndex
			: latest;
	}, null);

const getDisplayLedger = (
	network: PublicNetwork,
	statements: readonly PublicScpStatementObservation[],
	latestLedger: string | null
): PublicNetwork['latestLedger'] => {
	const latestObservedSlot = getLatestSlotIndex(statements);
	const candidates = [
		network.latestLedger.toString(),
		latestObservedSlot,
		latestLedger
	].filter((value): value is string => typeof value === 'string');

	return candidates.reduce((highest, candidate) =>
		BigInt(candidate) > BigInt(highest) ? candidate : highest
	);
};

const findStatementFallbackLink = (
	statement: PublicScpStatementObservation,
	links: readonly Graph3DLink[],
	nodesById: ReadonlyMap<string, Graph3DNode>
): Graph3DLink | null => {
	const outgoing = links.find(
		(link) =>
			getEndpointId(link.source) === statement.nodeId &&
			nodesById.has(getEndpointId(link.target) ?? '')
	);
	if (outgoing) return outgoing;

	const incoming = links.find(
		(link) =>
			getEndpointId(link.target) === statement.nodeId &&
			nodesById.has(getEndpointId(link.source) ?? '')
	);
	return incoming ?? null;
};

const getStatementFlowPath = (
	statement: PublicScpStatementObservation,
	links: readonly Graph3DLink[],
	nodesById: ReadonlyMap<string, Graph3DNode>
): StatementFlowPath | null => {
	const signer = nodesById.get(statement.nodeId);
	const observedPeer = nodesById.get(statement.observedFromPeer);
	if (signer && observedPeer && signer.id !== observedPeer.id) {
		return {
			label: `${statement.statementType} observed through ${getNodeLabel(observedPeer.node)}`,
			statement,
			source: signer,
			target: observedPeer
		};
	}

	const fallbackLink = findStatementFallbackLink(statement, links, nodesById);
	if (!fallbackLink) return null;

	const sourceId = getEndpointId(fallbackLink.source);
	const targetId = getEndpointId(fallbackLink.target);
	if (!sourceId || !targetId) return null;
	const source = nodesById.get(sourceId);
	const target = nodesById.get(targetId);
	if (!source || !target) return null;

	return {
		label: fallbackLink.label,
		statement,
		source,
		target
	};
};

const getExistingFlowLinkKeys = (
	path: StatementFlowPath,
	links: readonly Graph3DLink[]
): string[] =>
	links
		.filter((link) => {
			const sourceId = getEndpointId(link.source);
			const targetId = getEndpointId(link.target);
			return (
				(sourceId === path.source.id && targetId === path.target.id) ||
				(sourceId === path.target.id && targetId === path.source.id)
			);
		})
		.map(getGraphLinkKey);

export function GraphExplorer({
	network: initialNetwork,
	scpStatements: initialScpStatements
}: GraphExplorerProps): React.JSX.Element {
	const containerRef = useRef<HTMLDivElement>(null);
	const graphRef = useRef<ForceGraph3DInstance | null>(null);
	const packetGroupRef = useRef<ThreeGroup | null>(null);
	const threeRef = useRef<typeof import('three') | null>(null);
	const visualStateRef = useRef<GraphVisualState>({ ...defaultGraphVisualState });
	const animatedStatementHashesRef = useRef<Set<string>>(new Set());
	const animationTimeoutsRef = useRef<number[]>([]);
	const activityTimeoutsRef = useRef<number[]>([]);
	const activeWavesRef = useRef<Map<number, ActiveWave>>(new Map());
	const nextWaveIndexRef = useRef(0);
	const waveAnimationFrameRef = useRef<number | null>(null);
	const wavePoolRef = useRef<WaveMeshPool | null>(null);
	const nodeActivityRef = useRef<Map<string, number>>(new Map());
	const flowLinkColorsRef = useRef<Map<string, string>>(new Map());
	const [network, setNetwork] = useState(initialNetwork);
	const [scpStatements, setScpStatements] = useState(initialScpStatements);
	const [latestLedger, setLatestLedger] = useState<string | null>(null);
	const liveNetwork = useMemo(
		() => ({
			...network,
			latestLedger: getDisplayLedger(network, scpStatements, latestLedger)
		}),
		[latestLedger, network, scpStatements]
	);
	const model = useMemo(() => buildGraph3DModel(network), [network]);
	const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
	const [showAllConnectable, setShowAllConnectable] = useState(false);
	const [animationsEnabled, setAnimationsEnabled] = useState(true);
	const animationsEnabledRef = useRef(true);
	const [focusedOrganization, setFocusedOrganization] = useState<Graph3DOrganization | null>(null);
	const [hoveredOrganization, setHoveredOrganization] = useState<Graph3DOrganization | null>(null);
	const [contextMenu, setContextMenu] = useState<GraphContextMenuState | null>(null);
	const [activeStatementHashes, setActiveStatementHashes] = useState<ReadonlySet<string>>(
		() => new Set<string>()
	);
	const [selectedHistoryLogs, setSelectedHistoryLogs] =
		useState<readonly PublicHistoryArchiveScanLogEntry[]>([]);
	const [selectedHistoryLogStatus, setSelectedHistoryLogStatus] =
		useState<'idle' | 'loading' | 'loaded' | 'error'>('idle');
	const [showHistoryErrorsOnly, setShowHistoryErrorsOnly] = useState(false);
	const selectedNode = model.nodes.find((node) => node.id === selectedNodeId) ?? null;
	const modelNodesById = useMemo(
		() => new Map(model.nodes.map((node) => [node.id, node])),
		[model.nodes]
	);
	const selectedNodeOrganization = selectedNode
		? (model.organizations.find((candidate) => candidate.id === selectedNode.groupId) ?? null)
		: null;
	const selectedQuorumNodeIds = useMemo(
		() => collectQuorumValidatorIds(selectedNode?.node.quorumSet ?? null),
		[selectedNode]
	);
	const selectedQuorumRows = useMemo(
		() => buildQuorumRows(selectedNode?.node.quorumSet ?? null, modelNodesById),
		[modelNodesById, selectedNode]
	);
	const latestSlotIndex = useMemo(
		() => getLatestSlotIndex(scpStatements),
		[scpStatements]
	);
	const currentSlotStatements = useMemo(
		() =>
			(latestSlotIndex
				? scpStatements.filter(
						(statement) => statement.slotIndex === latestSlotIndex
					)
				: scpStatements
			).toSorted(compareStatementsByObservation),
		[latestSlotIndex, scpStatements]
	);
	const animatedSlotStatements = useMemo(
		() => selectLedgerAnimationStatements(currentSlotStatements, modelNodesById),
		[currentSlotStatements, modelNodesById]
	);
	const activeOrganization = hoveredOrganization ?? focusedOrganization ?? selectedNodeOrganization;
	const activeStatements = useMemo(() => {
		if (activeStatementHashes.size === 0) return [];
		return animatedSlotStatements
			.filter((statement) => activeStatementHashes.has(statement.statementHash))
			.toSorted(compareStatementsByObservation)
			.slice(-maxActiveFeedStatements);
	}, [activeStatementHashes, animatedSlotStatements]);
	const selectedNodeStatements = useMemo(
		() =>
			selectedNode
				? scpStatements
						.filter((statement) => statement.nodeId === selectedNode.id)
						.slice(0, 5)
				: [],
		[scpStatements, selectedNode]
	);
	const graphData = useMemo(() => {
		const nodes = showAllConnectable
			? model.nodes
			: model.nodes.filter((node) => node.kind === 'validator');
		const nodeIds = new Set(nodes.map((node) => node.id));
		const quorumLinks = model.links.filter(
			(link) => nodeIds.has(link.source) && nodeIds.has(link.target)
		);
		return {
			nodes: nodes.map((node) => ({ ...node })),
			links: quorumLinks.map((link) => ({ ...link }))
		};
	}, [model, showAllConnectable]);
	const nodesById = useMemo(
		() => new Map(graphData.nodes.map((node) => [node.id, node])),
		[graphData.nodes]
	);
	const graphDataRef = useRef(graphData);
	const nodesByIdRef = useRef(nodesById);
	const organizationsRef = useRef(model.organizations);
	const refreshGraphVisuals = useCallback((): void => {
		visualStateRef.current = {
			...visualStateRef.current,
			activeNodeWeights: new Map(nodeActivityRef.current)
		};
		graphRef.current?.refresh();
	}, []);

	const activateFlowPath = useCallback((path: StatementFlowPath): void => {
		const graph = graphRef.current;
		if (!graph) return;
		const color = getStatementColor(path.statement.statementType);

		for (const key of getExistingFlowLinkKeys(path, graphDataRef.current.links)) {
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
				if (nextWeight === 0) {
					nodeActivityRef.current.delete(nodeId);
				} else {
					nodeActivityRef.current.set(nodeId, nextWeight);
				}
				refreshGraphVisuals();
			}, 1_650);
			activityTimeoutsRef.current.push(timeout);
		}

		refreshGraphVisuals();
	}, [refreshGraphVisuals]);

	const updateWaveAnimations = useCallback((now: number): void => {
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
	}, []);

	const scheduleWaveAnimation = useCallback((): void => {
		if (!animationsEnabledRef.current) return;
		if (waveAnimationFrameRef.current !== null) return;
		graphRef.current?.resumeAnimation();
		waveAnimationFrameRef.current =
			window.requestAnimationFrame(updateWaveAnimations);
	}, [updateWaveAnimations]);

	const animateStatementPacket = useCallback((
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
		const midpoint = new THREE.Vector3().addVectors(source, target).multiplyScalar(0.5);
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
	}, [scheduleWaveAnimation]);

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

		const wavePool = wavePoolRef.current;
		if (wavePool) hideAllWaveSlots(wavePool);

		refreshGraphVisuals();
	}, [refreshGraphVisuals]);

	useEffect(() => {
		graphDataRef.current = graphData;
		nodesByIdRef.current = nodesById;
		organizationsRef.current = model.organizations;
		const graph = graphRef.current;
		if (!graph) return;
		graph.graphData(graphData);
		graph.refresh();
	}, [graphData, model.organizations, nodesById]);

	useEffect(() => {
		setNetwork(initialNetwork);
	}, [initialNetwork]);

	useEffect(() => {
		setScpStatements(initialScpStatements);
	}, [initialScpStatements]);

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
	}, [animationsEnabled, clearAnimationEffects, scheduleWaveAnimation]);

	useEffect(
		() =>
			subscribeToLatestLedger((sequence) => {
				setLatestLedger((current) => {
					if (!current) return sequence;
					return BigInt(sequence) > BigInt(current) ? sequence : current;
				});
			}),
		[]
	);

	useEffect(() => {
		let isMounted = true;
		const pendingRequests = new Set<AbortController>();

		const loadNetwork = (): void => {
			if (pendingRequests.size > 0) return;
			const abortController = new AbortController();
			pendingRequests.add(abortController);
			void fetchBrowserPublicNetwork(abortController.signal)
				.then((nextNetwork) => {
					if (isMounted) setNetwork(nextNetwork);
				})
				.catch(() => undefined)
				.finally(() => pendingRequests.delete(abortController));
		};

		loadNetwork();
		const interval = window.setInterval(loadNetwork, networkRefreshIntervalMs);
		const eventSource = new EventSource(buildBrowserApiUrl(liveNetworkPath, true));
		eventSource.addEventListener('network', (event) => {
			if (!isMounted) return;
			setNetwork(JSON.parse(event.data) as PublicNetwork);
		});
		eventSource.onerror = () => {
			loadNetwork();
		};

		return () => {
			isMounted = false;
			eventSource.close();
			for (const request of pendingRequests) request.abort();
			window.clearInterval(interval);
		};
	}, []);

	useEffect(() => {
		let isMounted = true;
		const pendingRequests = new Set<AbortController>();

		const loadLatestLedger = (): void => {
			if (pendingRequests.size > 0) return;
			const abortController = new AbortController();
			pendingRequests.add(abortController);
			void fetchBrowserLatestLedger(abortController.signal)
				.then((ledger) => {
					if (!isMounted) return;
					publishLatestLedger(ledger.sequence);
					setLatestLedger((current) => {
						if (!current) return ledger.sequence;
						return BigInt(ledger.sequence) > BigInt(current)
							? ledger.sequence
							: current;
					});
				})
				.catch(() => undefined)
				.finally(() => pendingRequests.delete(abortController));
		};

		loadLatestLedger();
		const interval = window.setInterval(
			loadLatestLedger,
			latestLedgerRefreshIntervalMs
		);
		return () => {
			isMounted = false;
			for (const request of pendingRequests) request.abort();
			window.clearInterval(interval);
		};
	}, []);

	useEffect(() => {
		let isMounted = true;
		const pendingRequests = new Set<AbortController>();

		const loadStatements = (): void => {
			if (pendingRequests.size > 0) return;
			const abortController = new AbortController();
			pendingRequests.add(abortController);
			void fetchBrowserScpStatements({ limit: 160 }, abortController.signal)
				.then((nextStatements) => {
					if (isMounted && nextStatements.length > 0) {
						setScpStatements(nextStatements);
					}
				})
				.catch(() => undefined)
				.finally(() => pendingRequests.delete(abortController));
		};

		loadStatements();
		const interval = window.setInterval(loadStatements, scpRefreshIntervalMs);
		const eventSource = new EventSource(
			buildBrowserApiUrl(liveScpStatementPath, true)
		);
		eventSource.addEventListener('scp', (event) => {
			if (!isMounted) return;
			const nextStatements = JSON.parse(
				event.data
			) as PublicScpStatementObservation[];
			if (nextStatements.length > 0) setScpStatements(nextStatements);
		});
		eventSource.onerror = () => {
			loadStatements();
		};

		return () => {
			isMounted = false;
			eventSource.close();
			for (const request of pendingRequests) request.abort();
			window.clearInterval(interval);
		};
	}, []);

	useEffect(() => {
		visualStateRef.current = {
			...visualStateRef.current,
			focusedOrganizationId: activeOrganization?.id ?? null,
			selectedQuorumNodeIds,
			selectedNodeId
		};
		graphRef.current?.refresh();
	}, [activeOrganization?.id, selectedNodeId, selectedQuorumNodeIds]);

	useEffect(() => {
		const historyUrl = selectedNode?.node.historyUrl;
		if (!historyUrl) {
			setSelectedHistoryLogs([]);
			setSelectedHistoryLogStatus('idle');
			return;
		}

		const abortController = new AbortController();
		setSelectedHistoryLogStatus('loading');
		void fetchBrowserHistoryArchiveScanLogs(historyUrl, abortController.signal)
			.then((logs) => {
				setSelectedHistoryLogs(logs);
				setSelectedHistoryLogStatus('loaded');
			})
			.catch(() => {
				if (abortController.signal.aborted) return;
				setSelectedHistoryLogs([]);
				setSelectedHistoryLogStatus('error');
			});

		return () => abortController.abort();
	}, [selectedNode?.node.historyUrl]);

	const visibleHistoryLogs = useMemo(
		() =>
			(showHistoryErrorsOnly
				? selectedHistoryLogs.filter(scanLogHasArchiveVerificationError)
				: selectedHistoryLogs
			).slice(0, 6),
		[selectedHistoryLogs, showHistoryErrorsOnly]
	);
	const selectedNodeHasArchiveErrors = selectedHistoryLogs.some(
		scanLogHasArchiveVerificationError
	);

	useEffect(() => {
		const closeContextMenu = (): void => setContextMenu(null);
		const closeContextMenuOnEscape = (event: KeyboardEvent): void => {
			if (event.key === 'Escape') closeContextMenu();
		};
		window.addEventListener('click', closeContextMenu);
		window.addEventListener('keydown', closeContextMenuOnEscape);
		return () => {
			window.removeEventListener('click', closeContextMenu);
			window.removeEventListener('keydown', closeContextMenuOnEscape);
		};
	}, []);

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
			const normalizedDelay =
				(observedAt - firstObservedAt) / observedSpan;
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
		animatedSlotStatements,
		animateStatementPacket,
		animationsEnabled
	]);

	useEffect(() => {
		let active = true;
		let observer: ResizeObserver | null = null;

		async function createGraph(): Promise<void> {
			if (!containerRef.current) return;
			const ForceGraph3D = (await import('3d-force-graph')).default;
			const THREE = await import('three');
			if (!active || !containerRef.current) return;

			const graph = new ForceGraph3D(containerRef.current, {
				controlType: 'orbit'
			});
			const keyLight = new THREE.DirectionalLight(0xffffff, 1.85);
			const rimLight = new THREE.DirectionalLight(0x58a6ff, 0.82);
			const packetGroup = new THREE.Group();
			const wavePool = createWaveMeshPool(THREE, packetGroup);
			keyLight.position.set(240, 320, 420);
			rimLight.position.set(-360, -220, 280);
			keyLight.castShadow = true;
			graph.renderer().shadowMap.enabled = true;
			graph.renderer().shadowMap.type = THREE.PCFSoftShadowMap;
			graph.scene().add(packetGroup);
			graphRef.current = graph;
			packetGroupRef.current = packetGroup;
			wavePoolRef.current = wavePool;
			threeRef.current = THREE;
			graph.resumeAnimation();
			scheduleWaveAnimation();
			graph
				.backgroundColor('#07111d')
				.graphData(graphDataRef.current)
				.nodeId('id')
				.nodeLabel((node) => {
					const graphNode = nodesByIdRef.current.get(String(node.id));
					return graphNode ? `${getNodeLabel(graphNode.node)}<br/>${graphNode.groupName}` : '';
				})
				.nodeVal('size')
				.nodeThreeObject((node) => {
					const graphNode = nodesByIdRef.current.get(String(node.id));
					return graphNode
						? createGraphNodeObject(graphNode, visualStateRef.current)
						: new THREE.Group();
				})
				.linkColor((link) =>
					flowLinkColorsRef.current.get(
						getGraphLinkKey(link as GraphLinkLike)
					) ?? getGraphLinkColor(link, nodesByIdRef.current, visualStateRef.current)
				)
				.linkLabel((link) => (link as GraphLinkLike).label ?? '')
				.linkOpacity(0.38)
				.linkWidth((link) =>
					flowLinkColorsRef.current.has(
						getGraphLinkKey(link as GraphLinkLike)
					)
						? 3.7
						: getGraphLinkWidth(link, nodesByIdRef.current, visualStateRef.current)
				)
				.linkDirectionalParticles(0)
				.linkDirectionalParticleColor(
					(link) =>
						flowLinkColorsRef.current.get(
							getGraphLinkKey(link as GraphLinkLike)
						) ?? '#58a6ff'
				)
				.linkDirectionalParticleSpeed(0.024)
				.linkDirectionalParticleWidth(
					(link) =>
						flowLinkColorsRef.current.has(
							getGraphLinkKey(link as GraphLinkLike)
						)
							? 3.4
							: 0
				)
				.showNavInfo(false)
				.enableNodeDrag(false)
				.lights([
					new THREE.AmbientLight(0x8ba6c4, 1.35),
					keyLight,
					rimLight,
					new THREE.HemisphereLight(0x7db8ff, 0x07111d, 1.2)
				])
				.onNodeHover((node) => {
					visualStateRef.current = {
						...visualStateRef.current,
						hoveredNodeId:
							node?.id === undefined ? null : String(node.id)
					};
					graph.refresh();
				})
				.onNodeClick((node) => {
					const graphNode = nodesByIdRef.current.get(String(node.id));
					if (!graphNode) return;
					setSelectedNodeId(graphNode.id);
					setFocusedOrganization(
						organizationsRef.current.find((org) => org.id === graphNode.groupId) ?? null
					);
					setContextMenu(null);
					graph.cameraPosition(getCameraTarget(graphNode), {
						x: graphNode.x ?? 0,
						y: graphNode.y ?? 0,
						z: graphNode.z ?? 0
					}, 850);
				})
				.onNodeRightClick((node, event) => {
					event.preventDefault();
					const graphNode = nodesByIdRef.current.get(String(node.id));
					if (!graphNode) return;
					setContextMenu({
						node: graphNode,
						x: event.clientX,
						y: event.clientY
					});
				})
				.onBackgroundClick(() => {
					setSelectedNodeId(null);
					setFocusedOrganization(null);
					setContextMenu(null);
				})
				.onBackgroundRightClick((event) => {
					event.preventDefault();
					setContextMenu({
						node: null,
						x: event.clientX,
						y: event.clientY
					});
				});

			const resize = (): void => {
				const bounds = containerRef.current?.getBoundingClientRect();
				if (!bounds) return;
				graph.width(bounds.width).height(bounds.height);
			};
			resize();
			observer = new ResizeObserver(resize);
			observer.observe(containerRef.current);
			graph.cameraPosition(initialCameraPosition, initialCameraTarget, 900);
		}

		createGraph();
		return () => {
			active = false;
			observer?.disconnect();
			if (waveAnimationFrameRef.current !== null) {
				window.cancelAnimationFrame(waveAnimationFrameRef.current);
				waveAnimationFrameRef.current = null;
			}
			activeWavesRef.current.clear();
			if (wavePoolRef.current) {
				disposeWaveMeshPool(wavePoolRef.current);
				wavePoolRef.current = null;
			}
			if (packetGroupRef.current) {
				graphRef.current?.scene().remove(packetGroupRef.current);
				packetGroupRef.current = null;
			}
			graphRef.current?._destructor();
			graphRef.current = null;
			threeRef.current = null;
		};
	}, []);

	const focusOrganization = (organization: Graph3DOrganization): void => {
		setFocusedOrganization(organization);
		setSelectedNodeId(null);
		const graph = graphRef.current;
		if (!graph) return;
		graph.cameraPosition(
			{ x: organization.x * 1.7, y: organization.y * 1.7, z: organization.z * 1.7 + 180 },
			{ x: organization.x, y: organization.y, z: organization.z },
			900
		);
	};
	const focusNodeOrganization = (node: Graph3DNode): void => {
		const organization =
			model.organizations.find((candidate) => candidate.id === node.groupId) ?? null;
		if (organization) focusOrganization(organization);
	};
	const resetCamera = (): void => {
		setFocusedOrganization(null);
		setHoveredOrganization(null);
		setSelectedNodeId(null);
		setContextMenu(null);
		graphRef.current?.cameraPosition(initialCameraPosition, initialCameraTarget, 700);
	};
	const copyPublicKey = (node: Graph3DNode): void => {
		void navigator.clipboard?.writeText(node.id);
	};
	return (
		<main className="graph-workspace">
			<div className="graph-canvas" ref={containerRef} />
			<section className="graph-overlay graph-summary">
				<p className="eyebrow">{liveNetwork.name}</p>
				<h1>Network topology</h1>
				<div className="summary-grid">
					<strong>{formatInteger(liveNetwork.statistics.nrOfConnectableNodes)}</strong>
					<span>connectable</span>
					<strong>{formatInteger(liveNetwork.statistics.nrOfActiveValidators)}</strong>
					<span>validators</span>
					<strong>{formatInteger(liveNetwork.organizations.length)}</strong>
					<span>organizations</span>
				</div>
				<button
					className={showAllConnectable ? 'graph-toggle active' : 'graph-toggle'}
					onClick={() => setShowAllConnectable((current) => !current)}
					type="button"
				>
					{showAllConnectable ? 'Validator topology' : 'All connectable nodes'}
				</button>
				<button
					aria-pressed={animationsEnabled}
					aria-label={
						animationsEnabled
							? 'Pause SCP animation'
							: 'Resume SCP animation'
					}
					className={
						animationsEnabled ? 'animation-toggle active' : 'animation-toggle'
					}
					onClick={() => setAnimationsEnabled((current) => !current)}
					type="button"
				>
					{animationsEnabled ? 'Pause SCP animation' : 'Resume SCP animation'}
				</button>
				<ScpAnalysisPanel network={liveNetwork} />
				<div className="organization-rail">
					<h2>Organizations</h2>
					{activeOrganization && (
						<div className="selected-organization-card">
							<span style={{ backgroundColor: activeOrganization.color }} />
							<div>
								<strong>{activeOrganization.name}</strong>
								<small>
									{activeOrganization.validatorCount} validators
									{activeOrganization.inTransitiveQuorumSet ? ' / top tier' : ''}
								</small>
								{selectedNode && selectedNode.groupId === activeOrganization.id && (
									<em>Selected: {getNodeLabel(selectedNode.node)}</em>
								)}
							</div>
						</div>
					)}
					<div className="organization-list">
						{model.organizations.slice(0, 14).map((organization) => (
							<button
								className={activeOrganization?.id === organization.id ? 'active' : ''}
								key={organization.id}
								onClick={() => focusOrganization(organization)}
								onMouseEnter={() => setHoveredOrganization(organization)}
								onMouseLeave={() => setHoveredOrganization(null)}
								type="button"
							>
								<span style={{ backgroundColor: organization.color }} />
								<strong>{organization.name}</strong>
								<small>
									{organization.validatorCount} validators
									{organization.inTransitiveQuorumSet ? ' / top tier' : ''}
								</small>
							</button>
						))}
					</div>
				</div>
			</section>
			<section className="graph-overlay scp-observation-orbit">
				<ScpLiveFeed
					activeStatements={activeStatements}
					network={liveNetwork}
					statements={scpStatements}
				/>
			</section>
			{selectedNode && (
				<section className="graph-overlay node-popover">
					<button className="close-button" onClick={() => setSelectedNodeId(null)} type="button">x</button>
					<p className="eyebrow">{selectedNode.kind}</p>
					<h2>{getNodeLabel(selectedNode.node)}</h2>
					<StatusTags tags={getNodeTags(selectedNode.node)} />
					<dl className="compact-details">
						<div><dt>Organization</dt><dd>{selectedNode.groupName}</dd></div>
						<div><dt>Public key</dt><dd>{selectedNode.id}</dd></div>
						<div><dt>Host</dt><dd>{selectedNode.node.host ?? selectedNode.node.ip}</dd></div>
						<div><dt>Version</dt><dd>{selectedNode.node.versionStr ?? 'Unknown'}</dd></div>
						<div><dt>Protocol</dt><dd>{formatNullableInteger(selectedNode.node.ledgerVersion)}</dd></div>
						<div><dt>Lag</dt><dd>{formatLag(selectedNode.node.lag)}</dd></div>
						<div><dt>Home domain</dt><dd>{selectedNode.node.homeDomain ?? 'Not reported'}</dd></div>
						<div><dt>Country</dt><dd>{selectedNode.node.geoData?.countryName ?? 'Unknown'}</dd></div>
						<div><dt>24H active</dt><dd>{formatAvailability(
							selectedNode.node.statistics.has24HourStats,
							selectedNode.node.statistics.active24HoursPercentage
						)}</dd></div>
						<div><dt>30D validating</dt><dd>{formatAvailability(
							selectedNode.node.statistics.has30DayStats,
							selectedNode.node.statistics.validating30DaysPercentage
						)}</dd></div>
						<div><dt>Archive</dt><dd>{selectedNode.node.historyUrl ?? 'Not reported'}</dd></div>
						<div><dt>Archive status</dt><dd>{selectedNodeHasArchiveErrors ? 'Archive warning' : 'No archive warning'}</dd></div>
						<div><dt>SCP evidence</dt><dd>{selectedNodeStatements.length} recent statements</dd></div>
					</dl>
					{selectedNode.node.historyUrl && (
						<div className="node-scan-log">
							<div className="node-panel-heading">
								<strong>History scan runs</strong>
								<button
									className={showHistoryErrorsOnly ? 'scan-log-toggle active' : 'scan-log-toggle'}
									onClick={() => setShowHistoryErrorsOnly((current) => !current)}
									type="button"
								>
									Errors only
								</button>
							</div>
							{visibleHistoryLogs.length > 0 ? (
								visibleHistoryLogs.map((historyLog) => {
									const archiveErrors = getArchiveVerificationErrors(historyLog.errors);
									const workerIssues = getWorkerIssues(historyLog.errors);
									const hasArchiveErrors = archiveErrors.length > 0;
									const hasWorkerIssues = workerIssues.length > 0;
									const visibleErrors = hasArchiveErrors
										? archiveErrors
										: workerIssues;

									return (
									<div
										className={hasArchiveErrors || hasWorkerIssues ? 'scan-log-card warning' : 'scan-log-card good'}
										key={`${historyLog.startDate}-${historyLog.latestScannedLedger}`}
									>
										<span>
											{hasArchiveErrors
												? 'Archive errors'
												: hasWorkerIssues
													? 'Worker issue'
													: 'No archive errors'}
										</span>
										<strong>
											{formatInteger(historyLog.latestVerifiedLedger)} latest verified
										</strong>
										<small>
											{formatShortDateTime(historyLog.endDate)} / {formatDuration(historyLog.durationMs)} / {formatInteger(historyLog.concurrency)} requests
										</small>
										{visibleErrors.length > 0 && (
											<code>{visibleErrors[0]?.message}</code>
										)}
									</div>
									);
								})
							) : (
								<p>{selectedHistoryLogStatus === 'loading' ? 'Loading scan log...' : 'No matching scan runs returned.'}</p>
							)}
						</div>
					)}
					{selectedQuorumRows.length > 0 && (
						<div className="node-quorum-table">
							<div className="node-panel-heading">
								<strong>Quorum set</strong>
								<span>{formatInteger(selectedQuorumNodeIds.size)} validators</span>
							</div>
							{selectedQuorumRows.slice(0, 6).map((row) => (
								<div className="quorum-row" key={row.id} style={{ paddingLeft: `${row.depth * 10}px` }}>
									<span>{row.threshold} of {row.totalEntries}</span>
									<div>
										{row.validators.slice(0, 8).map((validator) => (
											<em key={validator.id}>{validator.label} / {validator.organization}</em>
										))}
										{row.validators.length === 0 && <em>Nested quorum set</em>}
									</div>
								</div>
							))}
						</div>
					)}
					{selectedNodeStatements.length > 0 && (
						<div className="node-scp-feed">
							{selectedNodeStatements.map((statement) => (
								<div key={statement.statementHash}>
									<strong>{statement.statementType}</strong>
									<span>slot {statement.slotIndex}</span>
									<code>{getStatementValueHash(statement)}</code>
								</div>
							))}
						</div>
					)}
					<Link className="primary-button" href={`/nodes/${encodeURIComponent(selectedNode.id)}`}>
						Open node details
					</Link>
				</section>
			)}
			<GraphContextMenu
				menu={contextMenu}
				onClose={() => setContextMenu(null)}
				onCopyPublicKey={copyPublicKey}
				onFocusOrganization={focusNodeOrganization}
				onResetCamera={resetCamera}
				onToggleConnectable={() => {
					setShowAllConnectable((current) => !current);
					setContextMenu(null);
				}}
				showAllConnectable={showAllConnectable}
			/>
		</main>
	);
}
