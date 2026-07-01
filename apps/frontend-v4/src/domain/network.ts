import type { PublicNetwork, PublicNode, PublicOrganization } from '../api/types';

export interface NodeTag {
	label: string;
	tone: 'good' | 'warning' | 'danger' | 'neutral';
}

export const getNodeLabel = (node: PublicNode): string =>
	node.alias ?? node.name ?? node.host ?? node.publicKey.slice(0, 12);

export const getOrganizationLabel = (
	organization: PublicOrganization
): string => organization.name ?? organization.dba ?? organization.homeDomain;

export const getOrganizationForNode = (
	network: PublicNetwork,
	node: PublicNode
): PublicOrganization | null =>
	network.organizations.find(
		(organization) => organization.id === node.organizationId
	) ?? null;

export const getNodeTags = (node: PublicNode): NodeTag[] => {
	const tags: NodeTag[] = [];

	if (node.isValidating) tags.push({ label: 'validating', tone: 'good' });
	else if (node.isValidator) tags.push({ label: 'not validating', tone: 'danger' });
	else if (node.active) tags.push({ label: 'listener', tone: 'neutral' });

	if (node.historyArchiveHasError) tags.push({ label: 'archive', tone: 'warning' });
	if (node.connectivityError) tags.push({ label: 'connectivity', tone: 'danger' });
	if (node.stellarCoreVersionBehind) tags.push({ label: 'version', tone: 'warning' });
	if (node.overLoaded) tags.push({ label: 'overloaded', tone: 'warning' });

	return tags.length > 0 ? tags : [{ label: 'observed', tone: 'neutral' }];
};

export const getOrganizationTags = (
	organization: PublicOrganization
): NodeTag[] => {
	const tags: NodeTag[] = [];

	if (organization.subQuorumAvailable) {
		tags.push({ label: 'subquorum available', tone: 'good' });
	} else {
		tags.push({ label: 'subquorum risk', tone: 'warning' });
	}

	if (!organization.hasReliableUptime) {
		tags.push({ label: 'uptime watch', tone: 'warning' });
	}

	if (organization.tomlState !== 'Ok') {
		tags.push({ label: organization.tomlState, tone: 'neutral' });
	}

	return tags;
};

export const getActiveValidators = (nodes: PublicNode[]): PublicNode[] =>
	nodes.filter((node) => node.isValidator);

export const getListenerNodes = (nodes: PublicNode[]): PublicNode[] =>
	nodes.filter((node) => node.active && !node.isValidator);

export const getRiskNodes = (nodes: PublicNode[]): PublicNode[] =>
	nodes
		.filter(
			(node) =>
				node.isValidator &&
				(!node.isValidating ||
					node.connectivityError ||
					node.historyArchiveHasError ||
					node.stellarCoreVersionBehind)
		)
		.toSorted((left, right) => right.index - left.index);

export const getTopOrganizations = (
	organizations: PublicOrganization[]
): PublicOrganization[] =>
	organizations.toSorted(
		(left, right) =>
			right.validators.length - left.validators.length ||
			getOrganizationLabel(left).localeCompare(getOrganizationLabel(right))
	);
