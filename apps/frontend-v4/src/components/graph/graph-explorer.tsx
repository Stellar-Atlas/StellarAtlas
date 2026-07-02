'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ForceGraph3DInstance } from '3d-force-graph';
import type {
	Group as ThreeGroup,
	Mesh as ThreeMesh,
	MeshStandardMaterial,
	SphereGeometry
} from 'three';
import Link from 'next/link';
import type {
	PublicHistoryArchiveScanLogEntry,
	PublicNetwork,
	PublicScpStatementObservation
} from '../../api/types';
import {
	fetchBrowserHistoryArchiveScanLogs,
	fetchBrowserLatestLedger,
	fetchBrowserPublicNetwork,
	fetchBrowserScpStatements
} from '../../api/browser-client';
import {
	buildGraph3DModel,
	getNodeOrganizationName,
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

const formatAvailability = (hasStats: boolean, value: number): string =>
	hasStats ? formatPercent(value) : 'Collecting';

const formatNullableInteger = (value: number | null): string =>
	value === null ? 'Unknown' : formatInteger(value);

const formatLag = (value: number | null): string =>
	value === null ? 'Unknown' : value <= 0 ? '<1 ms observed' : `${formatInteger(value)} ms`;

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
	source: Graph3DNode;
	target: Graph3DNode;
}

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
	return '#7ee787';
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
	const activeStatementHashRef = useRef<string | null>(null);
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
	const [focusedOrganization, setFocusedOrganization] = useState<Graph3DOrganization | null>(null);
	const [hoveredOrganization, setHoveredOrganization] = useState<Graph3DOrganization | null>(null);
	const [contextMenu, setContextMenu] = useState<GraphContextMenuState | null>(null);
	const [activeStatementIndex, setActiveStatementIndex] = useState(0);
	const [selectedHistoryLogs, setSelectedHistoryLogs] =
		useState<readonly PublicHistoryArchiveScanLogEntry[]>([]);
	const [selectedHistoryLogStatus, setSelectedHistoryLogStatus] =
		useState<'idle' | 'loading' | 'loaded' | 'error'>('idle');
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
			latestSlotIndex
				? scpStatements.filter(
						(statement) => statement.slotIndex === latestSlotIndex
					)
				: scpStatements,
		[latestSlotIndex, scpStatements]
	);
	const activeOrganization = hoveredOrganization ?? focusedOrganization ?? selectedNodeOrganization;
	const activeStatement =
		currentSlotStatements.length > 0
			? (currentSlotStatements[
					activeStatementIndex % currentSlotStatements.length
				] ?? null)
			: null;
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
		return {
			nodes: nodes.map((node) => ({ ...node })),
			links: model.links
				.filter((link) => nodeIds.has(link.source) && nodeIds.has(link.target))
				.map((link) => ({ ...link }))
		};
	}, [model, showAllConnectable]);
	const nodesById = useMemo(
		() => new Map(graphData.nodes.map((node) => [node.id, node])),
		[graphData.nodes]
	);
	const graphDataRef = useRef(graphData);
	const nodesByIdRef = useRef(nodesById);
	const organizationsRef = useRef(model.organizations);
	const animateStatementPacket = useCallback((
		statement: PublicScpStatementObservation,
		path: StatementFlowPath
	): void => {
		const THREE = threeRef.current;
		const packetGroup = packetGroupRef.current;
		if (!THREE || !packetGroup) return;

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

		const packet: ThreeMesh<SphereGeometry, MeshStandardMaterial> =
			new THREE.Mesh(
				new THREE.SphereGeometry(6.8, 24, 24),
				new THREE.MeshStandardMaterial({
					color,
					emissive: color,
					emissiveIntensity: 3.1,
					opacity: 0.98,
					roughness: 0.12,
					transparent: true
				})
			);
		packet.add(new THREE.PointLight(color, 3.4, 120));
		packet.name = `scp-${statement.statementType}-packet`;
		packetGroup.add(packet);

		const durationMs =
			statement.statementType === 'nominate'
				? 900
				: statement.statementType === 'prepare'
					? 780
					: 680;
		const startedAt = performance.now();

		const setBezierPosition = (progress: number): void => {
			const inverse = 1 - progress;
			packet.position.set(
				inverse * inverse * source.x +
					2 * inverse * progress * midpoint.x +
					progress * progress * target.x,
				inverse * inverse * source.y +
					2 * inverse * progress * midpoint.y +
					progress * progress * target.y,
				inverse * inverse * source.z +
					2 * inverse * progress * midpoint.z +
					progress * progress * target.z
			);
		};

		const finishPacket = (): void => {
			packetGroup.remove(packet);
			packet.geometry.dispose();
			packet.material.dispose();
		};

		const tick = (now: number): void => {
			if (!packetGroupRef.current) {
				finishPacket();
				return;
			}
			const linearProgress = Math.min(1, (now - startedAt) / durationMs);
			const easedProgress = 1 - Math.pow(1 - linearProgress, 3);
			setBezierPosition(easedProgress);
			packet.material.opacity =
				linearProgress > 0.82 ? Math.max(0, 1 - (linearProgress - 0.82) * 5.6) : 0.96;

			if (linearProgress < 1) {
				window.requestAnimationFrame(tick);
				return;
			}

			finishPacket();
		};

		setBezierPosition(0);
		window.requestAnimationFrame(tick);
	}, []);

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
		setActiveStatementIndex(0);
	}, [latestSlotIndex]);

	useEffect(() => {
		let isMounted = true;
		const pendingRequests = new Set<AbortController>();

		const loadNetwork = (): void => {
			const abortController = new AbortController();
			pendingRequests.add(abortController);
			void fetchBrowserPublicNetwork(abortController.signal)
				.then((nextNetwork) => {
					if (isMounted) setNetwork(nextNetwork);
				})
				.catch(() => undefined)
				.finally(() => pendingRequests.delete(abortController));
		};

		const interval = window.setInterval(loadNetwork, networkRefreshIntervalMs);
		return () => {
			isMounted = false;
			for (const request of pendingRequests) request.abort();
			window.clearInterval(interval);
		};
	}, []);

	useEffect(() => {
		let isMounted = true;
		const pendingRequests = new Set<AbortController>();

		const loadLatestLedger = (): void => {
			const abortController = new AbortController();
			pendingRequests.add(abortController);
			void fetchBrowserLatestLedger(abortController.signal)
				.then((ledger) => {
					if (!isMounted) return;
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
		return () => {
			isMounted = false;
			for (const request of pendingRequests) request.abort();
			window.clearInterval(interval);
		};
	}, []);

	useEffect(() => {
		if (currentSlotStatements.length < 2) return;
			const interval = window.setInterval(() => {
				setActiveStatementIndex(
					(current) => (current + 1) % currentSlotStatements.length
				);
		}, 950);

		return () => window.clearInterval(interval);
	}, [currentSlotStatements.length]);

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
		const graph = graphRef.current;
		if (!graph || !activeStatement) return;

		const flowPath = getStatementFlowPath(
			activeStatement,
			graphData.links,
			nodesById
		);
		if (!flowPath) return;
		const color = getStatementColor(activeStatement.statementType);
		flowLinkColorsRef.current = new Map(
			getExistingFlowLinkKeys(flowPath, graphData.links).map((key) => [
				key,
				color
			])
		);
		activeStatementHashRef.current = activeStatement.statementHash;
		graph.refresh();
		animateStatementPacket(activeStatement, flowPath);

		const activeHash = activeStatement.statementHash;
		const timeout = window.setTimeout(() => {
			if (activeStatementHashRef.current !== activeHash) return;
			flowLinkColorsRef.current = new Map();
			graph.refresh();
		}, 950);

		return () => window.clearTimeout(timeout);
	}, [activeStatement, animateStatementPacket, graphData.links, nodesById]);

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
			keyLight.position.set(240, 320, 420);
			rimLight.position.set(-360, -220, 280);
			keyLight.castShadow = true;
			graph.renderer().shadowMap.enabled = true;
			graph.renderer().shadowMap.type = THREE.PCFSoftShadowMap;
			graph.scene().add(packetGroup);
			graphRef.current = graph;
			packetGroupRef.current = packetGroup;
			threeRef.current = THREE;
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
				.linkOpacity(0.34)
				.linkWidth((link) =>
					flowLinkColorsRef.current.has(
						getGraphLinkKey(link as GraphLinkLike)
					)
						? 3.2
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
	const latestHistoryLog = selectedHistoryLogs[0] ?? null;

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
				<ScpAnalysisPanel network={liveNetwork} />
				<ScpLiveFeed
					activeStatement={activeStatement}
					network={liveNetwork}
					statements={currentSlotStatements.slice(0, 8)}
				/>
			</section>
			<section className="graph-overlay organization-orbit">
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
					{model.organizations.slice(0, 18).map((organization) => (
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
			</section>
			{selectedNode && (
				<section className="graph-overlay node-popover">
					<button className="close-button" onClick={() => setSelectedNodeId(null)} type="button">x</button>
					<p className="eyebrow">{selectedNode.kind}</p>
					<h2>{getNodeLabel(selectedNode.node)}</h2>
					<StatusTags tags={getNodeTags(selectedNode.node)} />
					<dl className="compact-details">
						<div><dt>Organization</dt><dd>{getNodeOrganizationName(liveNetwork, selectedNode.node)}</dd></div>
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
						<div><dt>Archive status</dt><dd>{selectedNode.node.historyArchiveHasError ? 'Warning' : 'No warning'}</dd></div>
						<div><dt>SCP evidence</dt><dd>{selectedNodeStatements.length} recent statements</dd></div>
					</dl>
					{selectedNode.node.historyUrl && (
						<div className="node-scan-log">
							<div className="node-panel-heading">
								<strong>History scan runs</strong>
								<span>{selectedHistoryLogStatus}</span>
							</div>
							{latestHistoryLog ? (
								<div className={latestHistoryLog.hasError ? 'scan-log-card warning' : 'scan-log-card good'}>
									<span>{latestHistoryLog.hasError ? 'Errors recorded' : 'No errors'}</span>
									<strong>
										{formatInteger(latestHistoryLog.latestVerifiedLedger)} latest verified
									</strong>
									<small>
										{formatShortDateTime(latestHistoryLog.endDate)} / {formatDuration(latestHistoryLog.durationMs)} / {formatInteger(latestHistoryLog.concurrency)} requests
									</small>
									{latestHistoryLog.errors.length > 0 && (
										<code>{latestHistoryLog.errors[0]?.message}</code>
									)}
								</div>
							) : (
								<p>{selectedHistoryLogStatus === 'loading' ? 'Loading scan log...' : 'No scan runs returned.'}</p>
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
