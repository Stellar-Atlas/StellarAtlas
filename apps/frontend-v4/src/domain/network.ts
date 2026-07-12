import type {
	NetworkV1 as PublicNetwork,
	NodeV1 as PublicNode,
	OrganizationV1 as PublicOrganization
} from 'shared';

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
		tags.push({
			label: formatOrganizationTomlState(organization.tomlState),
			title: `stellar.toml state: ${organization.tomlState}`,
			tone: 'warning'
		});
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

const organizationTomlStateLabels: Readonly<Record<string, string>> = {
	ConnectionRefused: 'metadata connection refused',
	ConnectionResetByPeer: 'metadata connection reset',
	ConnectionTimeout: 'metadata connection timed out',
	DNSLookupFailed: 'metadata DNS lookup failed',
	EmptyValidatorsField: 'metadata lists no validators',
	Forbidden: 'metadata access forbidden',
	HostnameResolutionFailed: 'metadata host lookup failed',
	HostUnreachable: 'metadata host unreachable',
	NotFound: 'stellar.toml not found',
	ParsingError: 'stellar.toml could not be parsed',
	RequestTimeout: 'metadata request timed out',
	ServerError: 'metadata server error',
	SocketClosedPrematurely: 'metadata connection closed',
	SocketTimeout: 'metadata socket timed out',
	Unknown: 'metadata not checked',
	UnspecifiedError: 'metadata fetch failed',
	UnsupportedVersion: 'unsupported stellar.toml version',
	ValidatorNotSEP20Linked: 'validators not linked in metadata'
};

export function formatOrganizationTomlState(state: string): string {
	return organizationTomlStateLabels[state] ?? 'metadata fetch issue';
}

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
