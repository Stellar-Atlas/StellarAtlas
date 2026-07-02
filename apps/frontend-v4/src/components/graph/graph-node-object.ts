import * as THREE from 'three';
import { getNodeLabel } from '../../domain/network';
import type { Graph3DNode } from './model-3d';
import type { GraphVisualState } from './graph-visual-state';

const sphereGeometry = new THREE.SphereGeometry(1, 32, 20);
const haloGeometry = new THREE.SphereGeometry(1, 32, 16);

function getNodeRadius(node: Graph3DNode): number {
	if (node.kind === 'listener') return 4.5;
	if (node.kind === 'offline') return 4;
	return node.isInTransitiveQuorumSet ? 13 : 10;
}

function getNodeOpacity(
	node: Graph3DNode,
	visualState: GraphVisualState
): number {
	const focusedOrganizationId = visualState.focusedOrganizationId;
	if (focusedOrganizationId === null) return 1;
	if (node.groupId === focusedOrganizationId) return 1;
	if (visualState.selectedQuorumNodeIds.has(node.id)) return 0.86;
	if (node.isInTransitiveQuorumSet) return 0.52;
	return 0.2;
}

function isNodeEmphasized(
	node: Graph3DNode,
	visualState: GraphVisualState
): boolean {
	return (
		(visualState.activeNodeWeights.get(node.id) ?? 0) > 0 ||
		node.id === visualState.hoveredNodeId ||
		node.id === visualState.selectedNodeId ||
		visualState.selectedQuorumNodeIds.has(node.id) ||
		node.groupId === visualState.focusedOrganizationId
	);
}

function createLabelTexture(label: string, organization: string): THREE.CanvasTexture {
	const canvas = document.createElement('canvas');
	const context = canvas.getContext('2d');
	if (!context) return new THREE.CanvasTexture(canvas);

	const titleSize = 19;
	const subtitleSize = 12;
	context.font = `800 ${titleSize}px Inter, Arial, sans-serif`;
	const titleMetrics = context.measureText(label);
	context.font = `700 ${subtitleSize}px Inter, Arial, sans-serif`;
	const subtitleMetrics = context.measureText(organization);
	canvas.width = Math.ceil(Math.max(titleMetrics.width, subtitleMetrics.width)) + 30;
	canvas.height = 48;

	context.font = `800 ${titleSize}px Inter, Arial, sans-serif`;
	context.fillStyle = 'rgba(7, 17, 29, 0.72)';
	context.roundRect(0, 2, canvas.width, 43, 8);
	context.fill();
	context.fillStyle = '#dce8f6';
	context.fillText(label, 15, 22);
	context.font = `700 ${subtitleSize}px Inter, Arial, sans-serif`;
	context.fillStyle = 'rgba(174, 189, 205, 0.92)';
	context.fillText(organization, 15, 38);

	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	return texture;
}

function createNodeLabel(node: Graph3DNode, radius: number): THREE.Sprite {
	const label = getNodeLabel(node.node);
	const texture = createLabelTexture(label, node.groupName);
	const material = new THREE.SpriteMaterial({
		depthTest: false,
		depthWrite: false,
		map: texture,
		opacity: node.kind === 'validator' ? 0.92 : 0.72,
		transparent: true
	});
	const sprite = new THREE.Sprite(material);
	const scale = node.kind === 'validator' ? 25 : 20;
	const widestTextLength = Math.max(label.length, node.groupName.length * 0.68);
	sprite.position.set(0, radius + 12, 0);
	sprite.renderOrder = 10_000;
	sprite.scale.set(scale * Math.max(widestTextLength / 10, 1), scale * 0.42, 1);
	return sprite;
}

export function createGraphNodeObject(
	node: Graph3DNode,
	visualState: GraphVisualState
): THREE.Object3D {
	const group = new THREE.Group();
	const emphasized = isNodeEmphasized(node, visualState);
	const activityWeight = visualState.activeNodeWeights.get(node.id) ?? 0;
	const radius = getNodeRadius(node) * (emphasized ? 1.22 + activityWeight * 0.18 : 1);
	const opacity = getNodeOpacity(node, visualState);
	const baseColor = new THREE.Color(node.color);
	const material = new THREE.MeshPhysicalMaterial({
		clearcoat: node.kind === 'validator' ? 0.42 : 0.18,
		clearcoatRoughness: 0.36,
		color: baseColor,
		emissive: emphasized
			? baseColor.clone().multiplyScalar(0.32 + activityWeight * 0.5)
			: '#000000',
		metalness: node.kind === 'validator' ? 0.18 : 0.04,
		opacity,
		roughness: 0.33,
		transparent: opacity < 1
	});

	const sphere = new THREE.Mesh(sphereGeometry, material);
	sphere.castShadow = true;
	sphere.receiveShadow = true;
	sphere.scale.setScalar(radius);
	group.add(sphere);

	if (emphasized) {
		const halo = new THREE.Mesh(
			haloGeometry,
			new THREE.MeshBasicMaterial({
				color: baseColor,
				opacity: 0.16 + activityWeight * 0.2,
				transparent: true
			})
		);
		halo.scale.setScalar(radius * (1.85 + activityWeight * 0.45));
		group.add(halo);
	}

	if (node.kind === 'validator' || emphasized) {
		group.add(createNodeLabel(node, radius));
	}

	return group;
}

type GraphLinkEndpoint =
	| Graph3DNode
	| number
	| string
	| { id?: number | string }
	| undefined;

interface GraphLinkLike {
	color?: string;
	opacity?: number;
	relationship?: string;
	source?: GraphLinkEndpoint;
	target?: GraphLinkEndpoint;
}

function getEndpointId(endpoint: GraphLinkEndpoint): string | null {
	if (endpoint === undefined) return null;
	if (typeof endpoint === 'string') return endpoint;
	if (typeof endpoint === 'number') return endpoint.toString();
	if (endpoint.id === undefined) return null;
	return endpoint.id.toString();
}

export function getGraphLinkColor(
	link: GraphLinkLike,
	nodesById: Map<string, Graph3DNode>,
	visualState: GraphVisualState
): string {
	const sourceNode = getEndpointId(link.source);
	const targetNode = getEndpointId(link.target);
	const sourceGraphNode = sourceNode ? nodesById.get(sourceNode) : undefined;
	const targetGraphNode = targetNode ? nodesById.get(targetNode) : undefined;
	const focusedOrganizationId = visualState.focusedOrganizationId;
	const selectedNodeId = visualState.selectedNodeId;

	if (link.relationship === 'scp-observation') {
		return link.color ?? 'rgba(126, 231, 135, 0.88)';
	}

	if (
		selectedNodeId &&
		sourceNode === selectedNodeId &&
		targetNode &&
		visualState.selectedQuorumNodeIds.has(targetNode)
	) {
		return 'rgba(247, 207, 77, 0.98)';
	}

	if (selectedNodeId && targetNode === selectedNodeId) {
		return 'rgba(88, 166, 255, 0.78)';
	}

	if (focusedOrganizationId === null) return 'rgba(145, 213, 255, 0.42)';
	if (
		sourceGraphNode?.groupId === focusedOrganizationId ||
		targetGraphNode?.groupId === focusedOrganizationId
	) {
		return 'rgba(126, 231, 135, 0.82)';
	}

	return 'rgba(145, 213, 255, 0.1)';
}

export function getGraphLinkWidth(
	link: GraphLinkLike,
	nodesById: Map<string, Graph3DNode>,
	visualState: GraphVisualState
): number {
	const focusedOrganizationId = visualState.focusedOrganizationId;
	const sourceId = getEndpointId(link.source);
	const targetId = getEndpointId(link.target);
	const sourceNode = sourceId ? nodesById.get(sourceId) : undefined;
	const targetNode = targetId ? nodesById.get(targetId) : undefined;
	const selectedNodeId = visualState.selectedNodeId;

	if (link.relationship === 'scp-observation') return 1.65;

	if (
		selectedNodeId &&
		sourceId === selectedNodeId &&
		targetId &&
		visualState.selectedQuorumNodeIds.has(targetId)
	) {
		return 2.7;
	}

	if (selectedNodeId && targetId === selectedNodeId) return 1.45;

	if (focusedOrganizationId === null) return 0.38;

	return sourceNode?.groupId === focusedOrganizationId ||
		targetNode?.groupId === focusedOrganizationId
		? 1.15
		: 0.14;
}
