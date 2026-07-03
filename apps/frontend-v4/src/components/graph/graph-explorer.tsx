'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ForceGraph3DInstance } from '3d-force-graph';
import type { Group as ThreeGroup } from 'three';
import type {
	PublicHistoryArchiveScanLogEntry,
	PublicNetwork,
	PublicScpStatementObservation
} from '../../api/types';
import { fetchBrowserHistoryArchiveScanLogs } from '../../api/browser-client';
import {
	buildGraph3DModel,
	type Graph3DNode,
	type Graph3DOrganization
} from './model-3d';
import {
	GraphContextMenu,
	type GraphContextMenuState
} from './graph-context-menu';
import { buildQuorumRows, collectQuorumValidatorIds } from './graph-quorum';
import {
	defaultGraphVisualState,
	type GraphVisualState
} from './graph-visual-state';
import { ScpLiveFeed } from './scp-live-feed';
import { scanLogHasArchiveVerificationError } from '../../domain/history-archive';
import {
	compareStatementsByObservation,
	getDisplayLedger,
	getLatestSlotIndex,
	maxActiveFeedStatements,
	selectLedgerAnimationStatements
} from './scp-flow-paths';
import { type ActiveWave, type WaveMeshPool } from './graph-wave-animation';
import { initialCameraPosition, initialCameraTarget } from './graph-camera';
import { GraphSummaryPanel } from './graph-summary-panel';
import { GraphNodePopover } from './graph-node-popover';
import { useGraphLiveData } from './use-graph-live-data';
import { useGraphAnimation } from './use-graph-animation';
import {
	useGraphRenderer,
	type GraphRenderData,
	type GraphRendererStatus
} from './use-graph-renderer';

interface GraphExplorerProps {
	network: PublicNetwork;
	scpStatements: PublicScpStatementObservation[];
}

export function GraphExplorer({
	network: initialNetwork,
	scpStatements: initialScpStatements
}: GraphExplorerProps): React.JSX.Element {
	const containerRef = useRef<HTMLDivElement>(null);
	const graphRef = useRef<ForceGraph3DInstance | null>(null);
	const packetGroupRef = useRef<ThreeGroup | null>(null);
	const threeRef = useRef<typeof import('three') | null>(null);
	const visualStateRef = useRef<GraphVisualState>({
		...defaultGraphVisualState
	});
	const animatedStatementHashesRef = useRef<Set<string>>(new Set());
	const animationTimeoutsRef = useRef<number[]>([]);
	const activityTimeoutsRef = useRef<number[]>([]);
	const activeWavesRef = useRef<Map<number, ActiveWave>>(new Map());
	const nextWaveIndexRef = useRef(0);
	const waveAnimationFrameRef = useRef<number | null>(null);
	const wavePoolRef = useRef<WaveMeshPool | null>(null);
	const nodeActivityRef = useRef<Map<string, number>>(new Map());
	const flowLinkColorsRef = useRef<Map<string, string>>(new Map());
	const { latestLedger, network, scpStatements } = useGraphLiveData(
		initialNetwork,
		initialScpStatements
	);
	const [graphStatus, setGraphStatus] =
		useState<GraphRendererStatus>('loading');
	const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
	const [showAllConnectable, setShowAllConnectable] = useState(false);
	const [animationsEnabled, setAnimationsEnabled] = useState(true);
	const animationsEnabledRef = useRef(true);
	const [focusedOrganization, setFocusedOrganization] =
		useState<Graph3DOrganization | null>(null);
	const [hoveredOrganization, setHoveredOrganization] =
		useState<Graph3DOrganization | null>(null);
	const [contextMenu, setContextMenu] = useState<GraphContextMenuState | null>(
		null
	);
	const [activeStatementHashes, setActiveStatementHashes] = useState<
		ReadonlySet<string>
	>(() => new Set<string>());
	const [selectedHistoryLogs, setSelectedHistoryLogs] = useState<
		readonly PublicHistoryArchiveScanLogEntry[]
	>([]);
	const [selectedHistoryLogStatus, setSelectedHistoryLogStatus] = useState<
		'idle' | 'loading' | 'loaded' | 'error'
	>('idle');
	const [showHistoryErrorsOnly, setShowHistoryErrorsOnly] = useState(false);
	const liveNetwork = useMemo(
		() => ({
			...network,
			latestLedger: getDisplayLedger(network, scpStatements, latestLedger)
		}),
		[latestLedger, network, scpStatements]
	);
	const model = useMemo(() => buildGraph3DModel(network), [network]);
	const selectedNode =
		model.nodes.find((node) => node.id === selectedNodeId) ?? null;
	const modelNodesById = useMemo(
		() => new Map(model.nodes.map((node) => [node.id, node])),
		[model.nodes]
	);
	const selectedNodeOrganization = selectedNode
		? (model.organizations.find(
				(candidate) => candidate.id === selectedNode.groupId
			) ?? null)
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
		() =>
			selectLedgerAnimationStatements(currentSlotStatements, modelNodesById),
		[currentSlotStatements, modelNodesById]
	);
	const activeOrganization =
		hoveredOrganization ?? focusedOrganization ?? selectedNodeOrganization;
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
	const graphData: GraphRenderData = useMemo(() => {
		const nodes = showAllConnectable
			? model.nodes
			: model.nodes.filter((node) => node.kind === 'validator');
		const nodeIds = new Set(nodes.map((node) => node.id));
		const quorumLinks = model.links.filter(
			(link) => nodeIds.has(link.source) && nodeIds.has(link.target)
		);
		return {
			links: quorumLinks.map((link) => ({ ...link })),
			nodes: nodes.map((node) => ({ ...node }))
		};
	}, [model, showAllConnectable]);
	const nodesById = useMemo(
		() => new Map(graphData.nodes.map((node) => [node.id, node])),
		[graphData.nodes]
	);
	const graphDataRef = useRef(graphData);
	const nodesByIdRef = useRef(nodesById);
	const organizationsRef = useRef(model.organizations);
	const selectedNodeHasArchiveErrors = selectedHistoryLogs.some(
		scanLogHasArchiveVerificationError
	);

	const refreshGraphVisuals = useCallback((): void => {
		visualStateRef.current = {
			...visualStateRef.current,
			activeNodeWeights: new Map(nodeActivityRef.current)
		};
		graphRef.current?.refresh();
	}, []);

	const { scheduleWaveAnimation } = useGraphAnimation({
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
		visualStateRef,
		waveAnimationFrameRef,
		wavePoolRef
	});

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
		visualStateRef.current = {
			...visualStateRef.current,
			focusedOrganizationId: activeOrganization?.id ?? null,
			selectedNodeId,
			selectedQuorumNodeIds
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

	useGraphRenderer({
		activeWavesRef,
		containerRef,
		flowLinkColorsRef,
		graphDataRef,
		graphRef,
		nodesByIdRef,
		onStatusChange: setGraphStatus,
		organizationsRef,
		packetGroupRef,
		scheduleWaveAnimation,
		setContextMenu,
		setFocusedOrganization,
		setSelectedNodeId,
		threeRef,
		visualStateRef,
		waveAnimationFrameRef,
		wavePoolRef
	});

	const focusOrganization = (organization: Graph3DOrganization): void => {
		setFocusedOrganization(organization);
		setSelectedNodeId(null);
		const graph = graphRef.current;
		if (!graph) return;
		graph.cameraPosition(
			{
				x: organization.x * 1.7,
				y: organization.y * 1.7,
				z: organization.z * 1.7 + 180
			},
			{ x: organization.x, y: organization.y, z: organization.z },
			900
		);
	};

	const focusNodeOrganization = (node: Graph3DNode): void => {
		const organization =
			model.organizations.find((candidate) => candidate.id === node.groupId) ??
			null;
		if (organization) focusOrganization(organization);
	};

	const resetCamera = (): void => {
		setFocusedOrganization(null);
		setHoveredOrganization(null);
		setSelectedNodeId(null);
		setContextMenu(null);
		graphRef.current?.cameraPosition(
			initialCameraPosition,
			initialCameraTarget,
			700
		);
	};

	const copyPublicKey = (node: Graph3DNode): void => {
		void navigator.clipboard?.writeText(node.id);
	};

	return (
		<main className="graph-workspace">
			<div className="graph-canvas" ref={containerRef} />
			{graphStatus === 'error' && (
				<section className="graph-overlay graph-runtime-status">
					<p className="eyebrow">Graph</p>
					<h2>Renderer unavailable</h2>
					<p>The topology canvas could not initialize in this browser.</p>
				</section>
			)}
			{graphStatus !== 'error' && graphData.nodes.length === 0 && (
				<section className="graph-overlay graph-runtime-status">
					<p className="eyebrow">Topology</p>
					<h2>No validator graph available</h2>
					<p>The current network snapshot did not include validator nodes.</p>
				</section>
			)}
			<GraphSummaryPanel
				activeOrganization={activeOrganization}
				animationsEnabled={animationsEnabled}
				liveNetwork={liveNetwork}
				model={model}
				onFocusOrganization={focusOrganization}
				onHoverOrganizationChange={setHoveredOrganization}
				onToggleAnimations={() => setAnimationsEnabled((current) => !current)}
				onToggleConnectable={() => setShowAllConnectable((current) => !current)}
				selectedNode={selectedNode}
				showAllConnectable={showAllConnectable}
			/>
			<section className="graph-overlay scp-observation-orbit">
				<ScpLiveFeed
					activeStatements={activeStatements}
					network={liveNetwork}
					statements={scpStatements}
				/>
			</section>
			{selectedNode && (
				<GraphNodePopover
					onClose={() => setSelectedNodeId(null)}
					onToggleHistoryErrorsOnly={() =>
						setShowHistoryErrorsOnly((current) => !current)
					}
					selectedHistoryLogStatus={selectedHistoryLogStatus}
					selectedHistoryLogs={selectedHistoryLogs}
					selectedNode={selectedNode}
					selectedNodeHasArchiveErrors={selectedNodeHasArchiveErrors}
					selectedNodeStatements={selectedNodeStatements}
					selectedQuorumNodeIds={selectedQuorumNodeIds}
					selectedQuorumRows={selectedQuorumRows}
					showHistoryErrorsOnly={showHistoryErrorsOnly}
				/>
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
