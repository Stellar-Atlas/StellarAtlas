import type { BaseQuorumSet } from 'shared';
import type { LinkObject, NodeObject } from '3d-force-graph';
import type { PublicNetwork, PublicNode, PublicOrganization } from '../../api/types';
import {
	getNodeLabel,
	getOrganizationForNode,
	getOrganizationLabel
} from '../../domain/network';

export interface Graph3DNode extends NodeObject {
	id: string;
	color: string;
	detail: string;
	groupId: string;
	groupName: string;
	isInTransitiveQuorumSet: boolean;
	kind: 'validator' | 'listener' | 'offline';
	node: PublicNode;
	size: number;
}

export interface Graph3DLink extends LinkObject<Graph3DNode> {
	color: string;
	label: string;
	opacity: number;
	relationship: 'quorum-dependency';
	source: string;
	target: string;
}

export interface Graph3DOrganization {
	color: string;
	id: string;
	inTransitiveQuorumSet: boolean;
	name: string;
	nodeCount: number;
	validatorCount: number;
	x: number;
	y: number;
	z: number;
}

export interface Graph3DModel {
	links: Graph3DLink[];
	nodes: Graph3DNode[];
	organizations: Graph3DOrganization[];
}

const COLORS = ['#58a6ff', '#5dd39e', '#ff9d42', '#c084fc', '#ff6874', '#f7cf4d', '#48d6d2', '#a7b0bd'];
const goldenAngle = Math.PI * (3 - Math.sqrt(5));

const hashText = (text: string): number =>
	Array.from(text).reduce(
		(hash, character) => (hash * 31 + character.charCodeAt(0)) % 8191,
		11
	);

const getColor = (id: string, index: number): string =>
	COLORS[hashText(id) % COLORS.length] ?? COLORS[index % COLORS.length] ?? '#58a6ff';

const collectValidators = (
	quorumSet: BaseQuorumSet | null,
	validators: Set<string>
): void => {
	if (!quorumSet) return;
	for (const validator of quorumSet.validators) validators.add(validator);
	for (const innerSet of quorumSet.innerQuorumSets) collectValidators(innerSet, validators);
};

const getClusterCenter = (
	index: number,
	count: number,
	inTransitiveQuorumSet: boolean
): { x: number; y: number; z: number } => {
	const y = 1 - (index / Math.max(count - 1, 1)) * 2;
	const radiusAtY = Math.sqrt(1 - y * y);
	const theta = goldenAngle * index;
	const radius = inTransitiveQuorumSet ? 220 : 430;
	return {
		x: Math.cos(theta) * radiusAtY * radius,
		y: y * radius * 0.72,
		z: Math.sin(theta) * radiusAtY * radius
	};
};

const getMemberOffset = (index: number, count: number): { x: number; y: number; z: number } => {
	const angle = (Math.PI * 2 * index) / Math.max(count, 1);
	const radius = 32 + Math.min(count, 18) * 2.4;
	return {
		x: Math.cos(angle) * radius,
		y: Math.sin(angle) * radius,
		z: ((index % 5) - 2) * 16
	};
};

const groupNodes = (network: PublicNetwork): Map<string, PublicNode[]> => {
	const groups = new Map<string, PublicNode[]>();
	for (const node of network.nodes.filter((candidate) => candidate.isValidator)) {
		const key = node.organizationId ?? 'unaffiliated';
		groups.set(key, [...(groups.get(key) ?? []), node]);
	}
	return groups;
};

const buildValidatorNodes = (
	network: PublicNetwork,
	organizations: Graph3DOrganization[]
): Graph3DNode[] => {
	const transitiveValidators = new Set(network.transitiveQuorumSet);
	return (
	Array.from(groupNodes(network).entries()).flatMap(([groupId, nodes], groupIndex) => {
		const organization = organizations.find((candidate) => candidate.id === groupId);
		const color = organization?.color ?? getColor(groupId, groupIndex);
		const center = organization ?? getClusterCenter(groupIndex, organizations.length, false);

		return nodes.map((node, nodeIndex) => {
			const offset = getMemberOffset(nodeIndex, nodes.length);
			return {
				id: node.publicKey,
				color,
				detail: node.homeDomain ?? node.host ?? node.publicKey.slice(0, 12),
				groupId,
				groupName: organization?.name ?? 'Unaffiliated validators',
				isInTransitiveQuorumSet: transitiveValidators.has(node.publicKey),
				kind: 'validator',
				node,
				size: node.isValidating ? 8 : 6,
				x: center.x + offset.x,
				y: center.y + offset.y,
				z: center.z + offset.z,
				fx: center.x + offset.x,
				fy: center.y + offset.y,
				fz: center.z + offset.z
			};
		});
	})
	);
};

const buildOuterNodes = (network: PublicNetwork): Graph3DNode[] => {
	const outerNodes = network.nodes.filter((node) => !node.isValidator);
	return outerNodes.map((node, index) => {
		const y = 1 - (index / Math.max(outerNodes.length - 1, 1)) * 2;
		const radiusAtY = Math.sqrt(1 - y * y);
		const theta = goldenAngle * index;
		const band = index % 3;
		const radius = 980 + band * 95;
		const x = Math.cos(theta) * radiusAtY * radius;
		const positionY = y * radius * 0.8;
		const z = Math.sin(theta) * radiusAtY * radius;
		return {
			id: node.publicKey,
			color: node.active ? '#768390' : '#cf5f68',
			detail: node.homeDomain ?? node.host ?? node.publicKey.slice(0, 12),
			groupId: 'listeners',
			groupName: node.active ? 'Listener nodes' : 'Unavailable nodes',
			isInTransitiveQuorumSet: false,
			kind: node.active ? 'listener' : 'offline',
			node,
			size: node.active ? 3.2 : 2.8,
			x,
			y: positionY,
			z,
			fx: x,
			fy: positionY,
			fz: z
		};
	});
};

const buildOrganizations = (network: PublicNetwork): Graph3DOrganization[] => {
	const groupedNodes = groupNodes(network);
	const organizationMap = new Map(network.organizations.map((organization) => [organization.id, organization]));
	const transitiveValidators = new Set(network.transitiveQuorumSet);
	const entries = Array.from(groupedNodes.entries()).sort((left, right) => {
		const leftInTransitive = left[1].some((node) => transitiveValidators.has(node.publicKey));
		const rightInTransitive = right[1].some((node) => transitiveValidators.has(node.publicKey));
		if (leftInTransitive !== rightInTransitive) return leftInTransitive ? -1 : 1;
		return right[1].length - left[1].length;
	});

	return entries.map(([id, nodes], index) => {
		const inTransitiveQuorumSet = nodes.some((node) => transitiveValidators.has(node.publicKey));
		const center = getClusterCenter(index, entries.length, inTransitiveQuorumSet);
		const organization: PublicOrganization | undefined = organizationMap.get(id);
		return {
			...center,
			color: getColor(id, index),
			id,
			inTransitiveQuorumSet,
			name: organization ? getOrganizationLabel(organization) : 'Unaffiliated validators',
			nodeCount: nodes.length,
			validatorCount: nodes.filter((node) => node.isValidator).length
		};
	});
};

const buildLinks = (nodes: PublicNode[]): Graph3DLink[] => {
	const nodeIds = new Set(nodes.map((node) => node.publicKey));
	const nodesById = new Map(nodes.map((node) => [node.publicKey, node]));
	const linkIds = new Set<string>();
	const links: Graph3DLink[] = [];

	for (const node of nodes.filter((candidate) => candidate.isValidator)) {
		const validators = new Set<string>();
		collectValidators(node.quorumSet, validators);
		for (const validator of validators) {
			if (validator === node.publicKey || !nodeIds.has(validator)) continue;
			const id = `${node.publicKey}:${validator}`;
			if (linkIds.has(id)) continue;
			linkIds.add(id);
			const targetNode = nodesById.get(validator);
			links.push({
				color: '#91d5ff',
				label: `${getNodeLabel(node)} quorum set includes ${
					targetNode ? getNodeLabel(targetNode) : validator.slice(0, 12)
				}`,
				opacity: 0.18,
				relationship: 'quorum-dependency',
				source: node.publicKey,
				target: validator
			});
		}
	}
	return links.slice(0, 2200);
};

export const buildGraph3DModel = (network: PublicNetwork): Graph3DModel => {
	const organizations = buildOrganizations(network);
	return {
		links: buildLinks(network.nodes),
		nodes: [...buildValidatorNodes(network, organizations), ...buildOuterNodes(network)],
		organizations
	};
};

export const getNodeOrganizationName = (
	network: PublicNetwork,
	node: PublicNode
): string => {
	const organization = getOrganizationForNode(network, node);
	return organization ? getOrganizationLabel(organization) : 'Unaffiliated validators';
};
