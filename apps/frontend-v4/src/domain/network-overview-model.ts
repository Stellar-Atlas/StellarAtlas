import type {
	PublicNetwork,
	PublicNode,
	PublicOrganization
} from '../api/types';
import { getNodeLabel, getOrganizationLabel } from './network';

export interface OverviewOrganization {
	organization: PublicOrganization;
	validators: number;
	validating: number;
}

export function getOverviewOrganizations(
	network: PublicNetwork
): OverviewOrganization[] {
	return network.organizations
		.map((organization) => {
			const keys = new Set(organization.validators);
			const nodes = network.nodes.filter(
				(node) =>
					node.isValidator &&
					(node.organizationId === organization.id || keys.has(node.publicKey))
			);
			return {
				organization,
				validators: nodes.length,
				validating: nodes.filter((node) => node.isValidating).length
			};
		})
		.sort((a, b) =>
			getOrganizationLabel(a.organization).localeCompare(
				getOrganizationLabel(b.organization),
				'en'
			)
		);
}

export function getOverviewAttention(
	nodes: readonly PublicNode[]
): PublicNode[] {
	const priority = (node: PublicNode) =>
		Number(node.connectivityError) * 4 +
		Number(!node.isValidating) * 2 +
		Number(node.stellarCoreVersionBehind);
	return nodes
		.filter((node) => node.isValidator && priority(node) > 0)
		.toSorted(
			(a, b) =>
				priority(b) - priority(a) ||
				getNodeLabel(a).localeCompare(getNodeLabel(b), 'en')
		);
}

export function getOverviewVersions(
	nodes: readonly PublicNode[]
): [string, number][] {
	const versions = new Map<string, number>();
	for (const node of nodes.filter((node) => node.isValidating)) {
		const label =
			node.versionStr
				?.replace(/^stellar-core\s+/i, '')
				.replace(/^v(?=\d)/, '')
				.replace(/\s+\([a-f\d]+\).*$/i, '') || 'Not reported';
		versions.set(label, (versions.get(label) ?? 0) + 1);
	}
	return [...versions].sort(
		(a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'en')
	);
}
