'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ForceGraph3DInstance } from '3d-force-graph';
import Link from 'next/link';
import type { PublicNetwork } from '../../api/types';
import {
	buildGraph3DModel,
	getNodeOrganizationName,
	type Graph3DNode,
	type Graph3DOrganization
} from './model-3d';
import { getNodeLabel, getNodeTags } from '../../domain/network';
import { formatInteger, formatPercent } from '../../format/formatters';
import { StatusTags } from '../status-tags';

interface GraphExplorerProps {
	network: PublicNetwork;
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

export function GraphExplorer({ network }: GraphExplorerProps): React.JSX.Element {
	const containerRef = useRef<HTMLDivElement>(null);
	const graphRef = useRef<ForceGraph3DInstance | null>(null);
	const model = useMemo(() => buildGraph3DModel(network), [network]);
	const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
	const [showAllConnectable, setShowAllConnectable] = useState(false);
	const [focusedOrganization, setFocusedOrganization] = useState<Graph3DOrganization | null>(null);
	const selectedNode = model.nodes.find((node) => node.id === selectedNodeId) ?? null;
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

	useEffect(() => {
		let active = true;
		let observer: ResizeObserver | null = null;
		const nodesById = new Map(graphData.nodes.map((node) => [node.id, node]));

		async function createGraph(): Promise<void> {
			if (!containerRef.current) return;
			const ForceGraph3D = (await import('3d-force-graph')).default;
			if (!active || !containerRef.current) return;

			const graph = new ForceGraph3D(containerRef.current, {
				controlType: 'orbit'
			});
			graphRef.current = graph;
			graph
				.backgroundColor('#07111d')
				.graphData(graphData)
				.nodeId('id')
				.nodeLabel((node) => {
					const graphNode = nodesById.get(String(node.id));
					return graphNode ? `${getNodeLabel(graphNode.node)}<br/>${graphNode.groupName}` : '';
				})
				.nodeColor('color')
				.nodeVal('size')
				.linkColor('color')
				.linkOpacity(0.032)
				.linkWidth(0.28)
				.showNavInfo(false)
				.enableNodeDrag(false)
				.onNodeClick((node) => {
					const graphNode = nodesById.get(String(node.id));
					if (!graphNode) return;
					setSelectedNodeId(graphNode.id);
					setFocusedOrganization(model.organizations.find((org) => org.id === graphNode.groupId) ?? null);
					graph.cameraPosition(getCameraTarget(graphNode), {
						x: graphNode.x ?? 0,
						y: graphNode.y ?? 0,
						z: graphNode.z ?? 0
					}, 850);
				})
				.onBackgroundClick(() => {
					setSelectedNodeId(null);
					setFocusedOrganization(null);
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
	}, [graphData, model.organizations]);

	const focusOrganization = (organization: Graph3DOrganization): void => {
		setFocusedOrganization(organization);
		const graph = graphRef.current;
		if (!graph) return;
		graph.cameraPosition(
			{ x: organization.x * 1.7, y: organization.y * 1.7, z: organization.z * 1.7 + 180 },
			{ x: organization.x, y: organization.y, z: organization.z },
			900
		);
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
			</section>
			<section className="graph-overlay organization-orbit">
				<h2>Organizations</h2>
				<div className="organization-list">
					{model.organizations.slice(0, 18).map((organization) => (
						<button
							className={focusedOrganization?.id === organization.id ? 'active' : ''}
							key={organization.id}
							onClick={() => focusOrganization(organization)}
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
					</dl>
					<Link className="primary-button" href={`/nodes/${encodeURIComponent(selectedNode.id)}`}>
						Open node details
					</Link>
				</section>
			)}
		</main>
	);
}
