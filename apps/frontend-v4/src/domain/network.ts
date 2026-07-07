import type {
	PublicNetwork,
	PublicNode,
	PublicOrganization
} from '../api/types';

export interface NodeTag {
	label: string;
	title?: string;
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
	else if (node.isValidator)
		tags.push({ label: 'not validating', tone: 'danger' });
	else if (node.active) tags.push({ label: 'listener', tone: 'neutral' });

	if (node.historyArchiveHasError)
		tags.push({ label: 'archive issue', tone: 'warning' });
	if (node.connectivityError)
		tags.push({ label: 'connection failed', tone: 'danger' });
	if (node.stellarCoreVersionBehind)
		tags.push({ label: 'core behind', tone: 'warning' });
	if (node.overLoaded)
		tags.push({
			label: 'peer busy',
			title:
				'The latest crawl could not open a Stellar overlay connection because the peer reported it was busy',
			tone: 'warning'
		});

	return tags.length > 0
		? tags
		: [{ label: 'active listener', tone: 'neutral' }];
};

export const getOrganizationTags = (
	organization: PublicOrganization
): NodeTag[] => {
	const tags: NodeTag[] = [];

	if (organization.subQuorumAvailable) {
		tags.push({ label: 'quorum path available', tone: 'good' });
	} else {
		tags.push({ label: 'quorum path risk', tone: 'warning' });
	}

	if (!organization.hasReliableUptime) {
		tags.push({ label: 'low uptime', tone: 'warning' });
	}

	if (organization.tomlState !== 'Ok') {
		tags.push({ label: organization.tomlState, tone: 'neutral' });
	}

	if (
		(organization.tomlWarnings ?? []).includes(
			'TlsCertificateVerificationDisabled'
		)
	) {
		tags.push({ label: 'TOML TLS certificate', tone: 'warning' });
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
