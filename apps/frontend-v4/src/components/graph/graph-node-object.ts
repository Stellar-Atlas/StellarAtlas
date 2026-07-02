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
	if (node.isInTransitiveQuorumSet) return 0.52;
	return 0.2;
}

function isNodeEmphasized(
	node: Graph3DNode,
	visualState: GraphVisualState
): boolean {
	return (
		node.id === visualState.hoveredNodeId ||
		node.id === visualState.selectedNodeId ||
		node.groupId === visualState.focusedOrganizationId
	);
}

function createLabelTexture(label: string): THREE.CanvasTexture {
	const canvas = document.createElement('canvas');
	const context = canvas.getContext('2d');
	if (!context) return new THREE.CanvasTexture(canvas);

	const fontSize = 28;
	context.font = `700 ${fontSize}px Inter, Arial, sans-serif`;
	const metrics = context.measureText(label);
	canvas.width = Math.ceil(metrics.width) + 28;
	canvas.height = 48;

	context.font = `700 ${fontSize}px Inter, Arial, sans-serif`;
	context.fillStyle = 'rgba(7, 17, 29, 0.72)';
	context.roundRect(0, 3, canvas.width, 36, 8);
	context.fill();
	context.fillStyle = '#dce8f6';
	context.fillText(label, 14, 30);

	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	return texture;
}

function createNodeLabel(node: Graph3DNode, radius: number): THREE.Sprite {
	const label = getNodeLabel(node.node);
	const texture = createLabelTexture(label);
	const material = new THREE.SpriteMaterial({
		depthWrite: false,
		map: texture,
		opacity: node.kind === 'validator' ? 0.92 : 0.72,
		transparent: true
	});
	const sprite = new THREE.Sprite(material);
	const scale = node.kind === 'validator' ? 44 : 34;
	sprite.position.set(0, radius + 10, 0);
	sprite.scale.set(scale * Math.max(label.length / 8, 1), scale * 0.34, 1);
	return sprite;
}

export function createGraphNodeObject(
	node: Graph3DNode,
	visualState: GraphVisualState
): THREE.Object3D {
	const group = new THREE.Group();
	const emphasized = isNodeEmphasized(node, visualState);
	const radius = getNodeRadius(node) * (emphasized ? 1.22 : 1);
	const opacity = getNodeOpacity(node, visualState);
	const baseColor = new THREE.Color(node.color);
	const material = new THREE.MeshPhysicalMaterial({
		clearcoat: node.kind === 'validator' ? 0.42 : 0.18,
		clearcoatRoughness: 0.36,
		color: baseColor,
		emissive: emphasized ? baseColor.clone().multiplyScalar(0.32) : '#000000',
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
				opacity: 0.16,
				transparent: true
			})
		);
		halo.scale.setScalar(radius * 1.85);
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

	if (focusedOrganizationId === null) return 'rgba(145, 213, 255, 0.24)';
	if (
		sourceGraphNode?.groupId === focusedOrganizationId ||
		targetGraphNode?.groupId === focusedOrganizationId
	) {
		return 'rgba(126, 231, 135, 0.58)';
	}

	return 'rgba(145, 213, 255, 0.04)';
}

export function getGraphLinkWidth(
	link: GraphLinkLike,
	nodesById: Map<string, Graph3DNode>,
	visualState: GraphVisualState
): number {
	const focusedOrganizationId = visualState.focusedOrganizationId;
	if (focusedOrganizationId === null) return 0.22;

	const sourceId = getEndpointId(link.source);
	const targetId = getEndpointId(link.target);
	const sourceNode = sourceId ? nodesById.get(sourceId) : undefined;
	const targetNode = targetId ? nodesById.get(targetId) : undefined;

	return sourceNode?.groupId === focusedOrganizationId ||
		targetNode?.groupId === focusedOrganizationId
		? 0.85
		: 0.08;
}
