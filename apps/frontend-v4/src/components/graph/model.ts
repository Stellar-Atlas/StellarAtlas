import type { BaseQuorumSet } from 'shared';
import type { PublicNetwork, PublicNode } from '../../api/types';
import { getNodeLabel } from '../../domain/network';

export interface GraphNode {
	id: string;
	label: string;
	detail: string;
	x: number;
	y: number;
	radius: number;
	color: string;
	kind: 'validator' | 'listener' | 'offline';
	href: string;
}

export interface GraphEdge {
	id: string;
	source: string;
	target: string;
	color: string;
	opacity: number;
}

export interface GraphModel {
	nodes: GraphNode[];
	edges: GraphEdge[];
	width: number;
	height: number;
}

const PALETTE = [
	'#2f80b7',
	'#5a9f5b',
	'#df8b2d',
	'#7d67c6',
	'#c85258',
	'#d1a217',
	'#3fa7a1',
	'#7f8c99'
];

const hashText = (text: string): number =>
	Array.from(text).reduce((hash, character) => {
		return (hash * 31 + character.charCodeAt(0)) % 9973;
	}, 7);

const getColor = (key: string | null, fallbackIndex: number): string =>
	PALETTE[key ? hashText(key) % PALETTE.length : fallbackIndex % PALETTE.length] ??
	PALETTE[0] ??
	'#2f80b7';

const collectValidators = (
	quorumSet: BaseQuorumSet | null,
	validators: Set<string>
): void => {
	if (!quorumSet) return;

	for (const validator of quorumSet.validators) {
		validators.add(validator);
	}

	for (const innerSet of quorumSet.innerQuorumSets) {
		collectValidators(innerSet, validators);
	}
};

const groupValidators = (nodes: PublicNode[]): Map<string, PublicNode[]> => {
	const groups = new Map<string, PublicNode[]>();

	for (const node of nodes.filter((candidate) => candidate.isValidator)) {
		const key = node.organizationId ?? 'unaffiliated';
		groups.set(key, [...(groups.get(key) ?? []), node]);
	}

	return groups;
};

const buildValidatorNodes = (nodes: PublicNode[]): GraphNode[] => {
	const groups = Array.from(groupValidators(nodes).entries()).toSorted(
		(left, right) => right[1].length - left[1].length
	);
	const centerX = 600;
	const centerY = 330;

	return groups.flatMap(([organizationId, group], groupIndex) => {
		const groupAngle = (Math.PI * 2 * groupIndex) / Math.max(groups.length, 1);
		const groupRadius = groups.length < 2 ? 0 : 190 + (groupIndex % 2) * 42;
		const groupX = centerX + Math.cos(groupAngle) * groupRadius;
		const groupY = centerY + Math.sin(groupAngle) * groupRadius * 0.62;
		const color = getColor(organizationId, groupIndex);
		const memberRadius = 24 + Math.min(group.length, 14) * 3.6;

		return group.map((node, memberIndex) => {
			const angle = (Math.PI * 2 * memberIndex) / Math.max(group.length, 1);
			return {
				id: node.publicKey,
				label: getNodeLabel(node),
				detail: node.homeDomain ?? node.host ?? node.publicKey.slice(0, 12),
				x: groupX + Math.cos(angle) * memberRadius,
				y: groupY + Math.sin(angle) * memberRadius,
				radius: node.isValidating ? 9 : 7,
				color,
				kind: 'validator',
				href: `/nodes/${encodeURIComponent(node.publicKey)}`
			};
		});
	});
};

const buildOuterNodes = (nodes: PublicNode[]): GraphNode[] => {
	const outerNodes = nodes.filter((node) => !node.isValidator);
	const centerX = 600;
	const centerY = 330;

	return outerNodes.map((node, index) => {
		const angle = (Math.PI * 2 * index) / Math.max(outerNodes.length, 1);
		const radiusWave = index % 3;
		return {
			id: node.publicKey,
			label: getNodeLabel(node),
			detail: node.homeDomain ?? node.host ?? node.publicKey.slice(0, 12),
			x: centerX + Math.cos(angle) * (470 + radiusWave * 28),
			y: centerY + Math.sin(angle) * (250 + radiusWave * 18),
			radius: node.active ? 5 : 4,
			color: node.active ? '#657381' : '#bd6469',
			kind: node.active ? 'listener' : 'offline',
			href: `/nodes/${encodeURIComponent(node.publicKey)}`
		};
	});
};

const buildEdges = (nodes: PublicNode[], graphNodes: GraphNode[]): GraphEdge[] => {
	const graphNodeMap = new Map(graphNodes.map((node) => [node.id, node]));
	const edges: GraphEdge[] = [];

	for (const node of nodes.filter((candidate) => candidate.isValidator)) {
		const validators = new Set<string>();
		collectValidators(node.quorumSet, validators);
		const source = graphNodeMap.get(node.publicKey);
		if (!source) continue;

		for (const validator of validators) {
			const target = graphNodeMap.get(validator);
			if (!target || target.id === source.id) continue;
			edges.push({
				id: `${source.id}-${target.id}`,
				source: source.id,
				target: target.id,
				color: source.color,
				opacity: source.kind === 'validator' && target.kind === 'validator' ? 0.2 : 0.08
			});
		}
	}

	return edges.slice(0, 1800);
};

export const buildGraphModel = (network: PublicNetwork): GraphModel => {
	const nodes = [
		...buildValidatorNodes(network.nodes),
		...buildOuterNodes(network.nodes)
	];

	return {
		nodes,
		edges: buildEdges(network.nodes, nodes),
		width: 1200,
		height: 660
	};
};
