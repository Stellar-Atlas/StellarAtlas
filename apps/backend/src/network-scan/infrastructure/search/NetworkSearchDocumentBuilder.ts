import type { NetworkV1, NodeV1, OrganizationV1 } from 'shared';
import type { NetworkSearchDocument } from './NetworkSearchTypes.js';

const text = (value: string | null | undefined): string | undefined => {
	const normalized = value?.trim();
	return normalized && normalized.length > 0 ? normalized : undefined;
};

const nodeLabel = (node: NodeV1): string =>
	text(node.name) ?? text(node.alias) ?? text(node.host) ?? node.publicKey;

const organizationLabel = (organization: OrganizationV1): string =>
	text(organization.name) ??
	text(organization.dba) ??
	text(organization.homeDomain) ??
	organization.id;

const nodeArchiveStatus = (
	node: NodeV1
): NetworkSearchDocument['archiveStatus'] => {
	if (!node.historyUrl) return 'unknown';
	return node.historyArchiveHasError ? 'error' : 'ok';
};

const joinSearchText = (...parts: (string | undefined)[]): string =>
	parts
		.filter((part): part is string => part !== undefined && part.length > 0)
		.join(' ');

const safeDocumentId = (prefix: string, value: string): string =>
	`${prefix}_${value.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

const nodeDocument = (
	network: NetworkV1,
	node: NodeV1,
	organizationsById: ReadonlyMap<string, OrganizationV1>,
	topTierPublicKeys: ReadonlySet<string>,
	indexedAt: string
): NetworkSearchDocument => {
	const organization = node.organizationId
		? organizationsById.get(node.organizationId)
		: undefined;
	const organizationName = organization
		? organizationLabel(organization)
		: undefined;
	const label = nodeLabel(node);
	const detail = text(node.homeDomain) ?? text(node.host) ?? node.publicKey;

	return {
		active: node.active,
		archiveStatus: nodeArchiveStatus(node),
		content: joinSearchText(
			label,
			detail,
			node.publicKey,
			node.host ?? undefined,
			node.ip,
			node.versionStr ?? undefined,
			node.homeDomain ?? undefined,
			node.historyUrl ?? undefined,
			node.isp ?? undefined,
			node.geoData?.countryName ?? undefined,
			node.geoData?.countryCode ?? undefined,
			organizationName
		),
		countryCode: node.geoData?.countryCode ?? undefined,
		countryName: node.geoData?.countryName ?? undefined,
		detail,
		entityId: node.publicKey,
		entityType: 'node',
		fullValidator: node.isFullValidator,
		homeDomain: node.homeDomain ?? undefined,
		href: `/nodes/${encodeURIComponent(node.publicKey)}`,
		id: safeDocumentId('node', node.publicKey),
		indexedAt,
		isp: node.isp ?? undefined,
		label,
		latestLedger: network.latestLedger,
		networkTime: network.time,
		organizationId: node.organizationId ?? undefined,
		organizationName,
		publicKey: node.publicKey,
		topTier: topTierPublicKeys.has(node.publicKey),
		validating: node.isValidating,
		validator: node.isValidator,
		version: node.versionStr ?? undefined
	};
};

const organizationDocument = (
	network: NetworkV1,
	organization: OrganizationV1,
	indexedAt: string
): NetworkSearchDocument => {
	const label = organizationLabel(organization);
	const detail = text(organization.homeDomain) ?? organization.id;

	return {
		active: organization.validators.length > 0,
		archiveStatus: 'unknown',
		content: joinSearchText(
			label,
			detail,
			organization.id,
			organization.dba ?? undefined,
			organization.url ?? undefined,
			organization.horizonUrl ?? undefined,
			organization.github ?? undefined,
			organization.twitter ?? undefined,
			organization.officialEmail ?? undefined,
			organization.description ?? undefined
		),
		detail,
		entityId: organization.id,
		entityType: 'organization',
		homeDomain: organization.homeDomain,
		href: `/organizations/${encodeURIComponent(organization.id)}`,
		id: safeDocumentId('organization', organization.id),
		indexedAt,
		label,
		latestLedger: network.latestLedger,
		networkTime: network.time,
		organizationId: organization.id,
		organizationName: label,
		topTier: organization.subQuorumAvailable,
		validating: organization.validators.length > 0,
		validator: false
	};
};

export const buildNetworkSearchDocuments = (
	network: NetworkV1
): readonly NetworkSearchDocument[] => {
	const indexedAt = new Date().toISOString();
	const organizationsById = new Map(
		network.organizations.map((organization) => [organization.id, organization])
	);
	const topTierPublicKeys = new Set(network.transitiveQuorumSet);

	return [
		...network.organizations.map((organization) =>
			organizationDocument(network, organization, indexedAt)
		),
		...network.nodes.map((node) =>
			nodeDocument(
				network,
				node,
				organizationsById,
				topTierPublicKeys,
				indexedAt
			)
		)
	];
};
