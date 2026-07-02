'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ForceGraph3DInstance } from '3d-force-graph';
import Link from 'next/link';
import type {
	PublicNetwork,
	PublicScpStatementObservation
} from '../../api/types';
import {
	buildGraph3DModel,
	getNodeOrganizationName,
	type Graph3DNode,
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

const initialCameraPosition = { x: 0, y: -80, z: 720 };
const initialCameraTarget = { x: 0, y: 0, z: 0 };

const formatAvailability = (hasStats: boolean, value: number): string =>
	hasStats ? formatPercent(value) : 'Collecting';

const formatNullableInteger = (value: number | null): string =>
	value === null ? 'Unknown' : formatInteger(value);

const formatLag = (value: number | null): string =>
	value === null ? 'Unknown' : `${formatInteger(value)} ms`;

export function GraphExplorer({
	network,
	scpStatements
}: GraphExplorerProps): React.JSX.Element {
	const containerRef = useRef<HTMLDivElement>(null);
	const graphRef = useRef<ForceGraph3DInstance | null>(null);
	const visualStateRef = useRef<GraphVisualState>({ ...defaultGraphVisualState });
	const model = useMemo(() => buildGraph3DModel(network), [network]);
	const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
	const [showAllConnectable, setShowAllConnectable] = useState(false);
	const [focusedOrganization, setFocusedOrganization] = useState<Graph3DOrganization | null>(null);
	const [hoveredOrganization, setHoveredOrganization] = useState<Graph3DOrganization | null>(null);
	const [contextMenu, setContextMenu] = useState<GraphContextMenuState | null>(null);
	const [activeStatementIndex, setActiveStatementIndex] = useState(0);
	const selectedNode = model.nodes.find((node) => node.id === selectedNodeId) ?? null;
	const activeOrganization = hoveredOrganization ?? focusedOrganization;
	const activeStatement =
		scpStatements.length > 0
			? (scpStatements[activeStatementIndex % scpStatements.length] ?? null)
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

	useEffect(() => {
		if (scpStatements.length < 2) return;
		const interval = window.setInterval(() => {
			setActiveStatementIndex((current) => (current + 1) % scpStatements.length);
		}, 1600);

		return () => window.clearInterval(interval);
	}, [scpStatements.length]);

	useEffect(() => {
		visualStateRef.current = {
			...visualStateRef.current,
			focusedOrganizationId: activeOrganization?.id ?? null,
			selectedNodeId
		};
		graphRef.current?.refresh();
	}, [activeOrganization?.id, selectedNodeId]);

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
			keyLight.position.set(240, 320, 420);
			rimLight.position.set(-360, -220, 280);
			keyLight.castShadow = true;
			graph.renderer().shadowMap.enabled = true;
			graph.renderer().shadowMap.type = THREE.PCFSoftShadowMap;
			graphRef.current = graph;
			graph
				.backgroundColor('#07111d')
				.graphData(graphData)
				.nodeId('id')
				.nodeLabel((node) => {
					const graphNode = nodesById.get(String(node.id));
					return graphNode ? `${getNodeLabel(graphNode.node)}<br/>${graphNode.groupName}` : '';
				})
				.nodeVal('size')
				.nodeThreeObject((node) => {
					const graphNode = nodesById.get(String(node.id));
					return graphNode
						? createGraphNodeObject(graphNode, visualStateRef.current)
						: new THREE.Group();
				})
				.linkColor((link) =>
					getGraphLinkColor(link, nodesById, visualStateRef.current)
				)
				.linkOpacity(0.16)
				.linkWidth((link) =>
					getGraphLinkWidth(link, nodesById, visualStateRef.current)
				)
				.linkDirectionalParticles((link) =>
					getGraphLinkWidth(link, nodesById, visualStateRef.current) > 0.5 ? 3 : 1
				)
				.linkDirectionalParticleColor(() => '#58a6ff')
				.linkDirectionalParticleSpeed(0.0025)
				.linkDirectionalParticleWidth(1.2)
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
					const graphNode = nodesById.get(String(node.id));
					if (!graphNode) return;
					setSelectedNodeId(graphNode.id);
					setFocusedOrganization(model.organizations.find((org) => org.id === graphNode.groupId) ?? null);
					setContextMenu(null);
					graph.cameraPosition(getCameraTarget(graphNode), {
						x: graphNode.x ?? 0,
						y: graphNode.y ?? 0,
						z: graphNode.z ?? 0
					}, 850);
				})
				.onNodeRightClick((node, event) => {
					event.preventDefault();
					const graphNode = nodesById.get(String(node.id));
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
			graphRef.current?._destructor();
			graphRef.current = null;
		};
	}, [graphData, model.organizations, nodesById]);

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
				<p className="eyebrow">{network.name}</p>
				<h1>Network topology</h1>
				<div className="summary-grid">
					<strong>{formatInteger(network.statistics.nrOfConnectableNodes)}</strong>
					<span>connectable</span>
					<strong>{formatInteger(network.statistics.nrOfActiveValidators)}</strong>
					<span>validators</span>
					<strong>{formatInteger(network.organizations.length)}</strong>
					<span>organizations</span>
				</div>
				<button
					className={showAllConnectable ? 'graph-toggle active' : 'graph-toggle'}
					onClick={() => setShowAllConnectable((current) => !current)}
					type="button"
				>
					{showAllConnectable ? 'Validator topology' : 'All connectable nodes'}
				</button>
				<ScpAnalysisPanel network={network} />
				<ScpLiveFeed
					activeStatement={activeStatement}
					network={network}
					statements={scpStatements.slice(0, 8)}
				/>
			</section>
			<section className="graph-overlay organization-orbit">
				<h2>Organizations</h2>
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
						<div><dt>Organization</dt><dd>{getNodeOrganizationName(network, selectedNode.node)}</dd></div>
						<div><dt>Public key</dt><dd>{selectedNode.id}</dd></div>
						<div><dt>Host</dt><dd>{selectedNode.node.host ?? selectedNode.node.ip}</dd></div>
						<div><dt>Version</dt><dd>{selectedNode.node.versionStr ?? 'Unknown'}</dd></div>
						<div><dt>Protocol</dt><dd>{formatNullableInteger(selectedNode.node.ledgerVersion)}</dd></div>
						<div><dt>Lag</dt><dd>{formatLag(selectedNode.node.lag)}</dd></div>
						<div><dt>Country</dt><dd>{selectedNode.node.geoData?.countryName ?? 'Unknown'}</dd></div>
						<div><dt>24H active</dt><dd>{formatAvailability(
							selectedNode.node.statistics.has24HourStats,
							selectedNode.node.statistics.active24HoursPercentage
						)}</dd></div>
						<div><dt>30D validating</dt><dd>{formatAvailability(
							selectedNode.node.statistics.has30DayStats,
							selectedNode.node.statistics.validating30DaysPercentage
						)}</dd></div>
						<div><dt>Archive</dt><dd>{selectedNode.node.historyArchiveHasError ? 'Warning' : 'No warning'}</dd></div>
						<div><dt>SCP evidence</dt><dd>{selectedNodeStatements.length} recent statements</dd></div>
					</dl>
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
