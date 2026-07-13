import { createHash } from 'node:crypto';
import type { NodeV1, OrganizationV1 } from 'shared';
import type { KnownNodeListItemDTO } from '../../use-cases/get-known-nodes/GetKnownNodesDTO.js';
import type { KnownOrganizationListItemDTO } from '../../use-cases/get-known-organizations/GetKnownOrganizationsDTO.js';
import type {
	NetworkSearchDocument,
	NetworkSearchDocumentScope,
	NetworkSearchInventory,
	NetworkSearchRecordState,
	NetworkSearchSnapshot
} from './NetworkSearchTypes.js';

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
	node: NodeV1,
	archiveStatusByNodePublicKey: ReadonlyMap<
		string,
		NetworkSearchDocument['archiveStatus']
	>
): NetworkSearchDocument['archiveStatus'] => {
	if (!node.historyUrl) return 'unknown';
	return archiveStatusByNodePublicKey.get(node.publicKey) ?? 'unknown';
};

const currentArchiveEvidenceStatus = (
	root: NetworkSearchInventory['archiveRoots'][number]
): NetworkSearchDocument['archiveStatus'] => {
	if (
		root.checkpoints.mismatchedCheckpoints > 0 ||
		root.objects.remoteFailureObjects > 0
	)
		return 'error';
	if (root.checkpoints.verifiedCheckpoints > 0) return 'ok';
	return 'unknown';
};

const buildArchiveStatusByNodePublicKey = (
	roots: NetworkSearchInventory['archiveRoots']
): ReadonlyMap<string, NetworkSearchDocument['archiveStatus']> => {
	const statuses = new Map<string, NetworkSearchDocument['archiveStatus']>();
	for (const root of roots) {
		const status = currentArchiveEvidenceStatus(root);
		for (const publicKey of root.nodePublicKeys) {
			const existing = statuses.get(publicKey);
			if (
				existing === undefined ||
				status === 'error' ||
				(existing === 'unknown' && status === 'ok')
			) {
				statuses.set(publicKey, status);
			}
		}
	}
	return statuses;
};

const joinSearchText = (...parts: (string | undefined)[]): string =>
	parts
		.filter((part): part is string => part !== undefined && part.length > 0)
		.join(' ');

const safeDocumentId = (prefix: string, value: string): string =>
	`${prefix}_${value.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

const recordState = (
	current: boolean,
	identityOnly = false
): NetworkSearchRecordState => {
	if (identityOnly) return 'identity-only';
	return current ? 'current' : 'historical';
};

const organizationScope = (
	knownOrganization: KnownOrganizationListItemDTO
): NetworkSearchDocumentScope => {
	if (!knownOrganization.current) return 'archived';
	return 'current-organization';
};

const nodeDocument = (
	inventory: NetworkSearchInventory,
	knownNode: KnownNodeListItemDTO,
	organizationsById: ReadonlyMap<string, OrganizationV1>,
	topTierPublicKeys: ReadonlySet<string>,
	archiveStatusByNodePublicKey: ReadonlyMap<
		string,
		NetworkSearchDocument['archiveStatus']
	>,
	canonicalCursor: string
): NetworkSearchDocument => {
	const node = knownNode.node;
	const organization = node?.organizationId
		? organizationsById.get(node.organizationId)
		: undefined;
	const organizationName = organization
		? organizationLabel(organization)
		: undefined;
	const label = node ? nodeLabel(node) : knownNode.publicKey;
	const detail = node
		? (text(node.homeDomain) ?? text(node.host) ?? node.publicKey)
		: 'Public key observed without a retained node snapshot';

	return {
		active: knownNode.current && (node?.active ?? false),
		archiveStatus: node
			? nodeArchiveStatus(node, archiveStatusByNodePublicKey)
			: 'unknown',
		canonicalCursor,
		content: joinSearchText(
			label,
			detail,
			knownNode.publicKey,
			node?.host ?? undefined,
			node?.ip,
			node?.versionStr ?? undefined,
			node?.homeDomain ?? undefined,
			node?.historyUrl ?? undefined,
			node?.isp ?? undefined,
			node?.geoData?.countryName ?? undefined,
			node?.geoData?.countryCode ?? undefined,
			organizationName
		),
		countryCode: node?.geoData?.countryCode ?? undefined,
		countryName: node?.geoData?.countryName ?? undefined,
		detail,
		documentKind: 'entity',
		entityId: knownNode.publicKey,
		entityType: 'node',
		fullValidator: node?.isFullValidator ?? false,
		homeDomain: node?.homeDomain ?? undefined,
		href: `/nodes/${encodeURIComponent(knownNode.publicKey)}`,
		id: safeDocumentId('node', knownNode.publicKey),
		indexedAt: inventory.generatedAt,
		isp: node?.isp ?? undefined,
		label,
		latestLedger: inventory.network.latestLedger,
		networkTime: inventory.network.time,
		observedAt:
			knownNode.lastSeen ??
			knownNode.lastMeasurementAt ??
			knownNode.dateDiscovered,
		organizationId: node?.organizationId ?? undefined,
		organizationName,
		publicKey: knownNode.publicKey,
		recordState: recordState(
			knownNode.current,
			knownNode.metadataState === 'public_key_only'
		),
		scope: knownNode.scope,
		topTier: topTierPublicKeys.has(knownNode.publicKey),
		validating: knownNode.current && (node?.isValidating ?? false),
		validator: knownNode.current && (node?.isValidator ?? false),
		version: node?.versionStr ?? undefined
	};
};

const organizationDocument = (
	inventory: NetworkSearchInventory,
	knownOrganization: KnownOrganizationListItemDTO,
	canonicalCursor: string
): NetworkSearchDocument => {
	const organization = knownOrganization.organization;
	const label = organizationLabel(organization);
	const detail = text(organization.homeDomain) ?? organization.id;

	return {
		active: knownOrganization.current && organization.validators.length > 0,
		archiveStatus: 'unknown',
		canonicalCursor,
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
		documentKind: 'entity',
		entityId: organization.id,
		entityType: 'organization',
		homeDomain: organization.homeDomain,
		href: `/organizations/${encodeURIComponent(organization.id)}`,
		id: safeDocumentId('organization', organization.id),
		indexedAt: inventory.generatedAt,
		label,
		latestLedger: inventory.network.latestLedger,
		networkTime: inventory.network.time,
		observedAt:
			knownOrganization.lastSeen ?? knownOrganization.snapshotStartDate,
		organizationId: organization.id,
		organizationName: label,
		recordState: recordState(knownOrganization.current),
		scope: organizationScope(knownOrganization),
		topTier: knownOrganization.current && organization.subQuorumAvailable,
		validating: knownOrganization.current && organization.validators.length > 0,
		validator: false
	};
};

const archiveRootDocument = (
	inventory: NetworkSearchInventory,
	root: NetworkSearchInventory['archiveRoots'][number],
	canonicalCursor: string
): NetworkSearchDocument => {
	const failures = root.objects.remoteFailureObjects;
	const verified = root.objects.verifiedObjects;
	const host = new URL(root.archiveUrl).host;
	return {
		active: root.objects.activeObjects > 0,
		archiveStatus: currentArchiveEvidenceStatus(root),
		canonicalCursor,
		content: joinSearchText(
			host,
			root.archiveUrl,
			...root.nodePublicKeys,
			`${verified} verified`,
			`${failures} failures`
		),
		detail: `${verified} verified file checks; ${failures} remote failures`,
		documentKind: 'entity',
		entityId: root.archiveUrlIdentity,
		entityType: 'archive-root',
		evidenceFailures: failures,
		evidenceProvenance: 'postgres_canonical',
		evidenceVerified: verified,
		href: `/archive-scans/${encodeURIComponent(root.archiveUrl)}`,
		id: safeDocumentId('archive', root.archiveUrlIdentity),
		indexedAt: inventory.generatedAt,
		label: host,
		latestLedger: inventory.network.latestLedger,
		networkTime: inventory.network.time,
		observedAt: root.latestObjectAt ?? inventory.generatedAt,
		recordState: 'current',
		scope: 'archive-root'
	};
};

export const buildNetworkSearchSnapshot = (
	inventory: NetworkSearchInventory
): NetworkSearchSnapshot => {
	const nodes = inventory.nodes.toSorted((left, right) =>
		left.publicKey.localeCompare(right.publicKey)
	);
	const organizations = inventory.organizations.toSorted((left, right) =>
		left.organization.id.localeCompare(right.organization.id)
	);
	const canonicalCursor = createHash('sha256')
		.update(
			JSON.stringify({
				archiveRoots: inventory.archiveRoots,
				latestLedger: inventory.network.latestLedger,
				networkTime: inventory.network.time,
				nodes,
				organizations,
				transitiveQuorumSet: inventory.network.transitiveQuorumSet.toSorted()
			})
		)
		.digest('hex');
	const organizationsById = new Map(
		organizations.map(({ organization }) => [organization.id, organization])
	);
	const topTierPublicKeys = new Set(inventory.network.transitiveQuorumSet);
	const archiveStatusByNodePublicKey = buildArchiveStatusByNodePublicKey(
		inventory.archiveRoots
	);

	return {
		canonicalCursor,
		documents: [
			...inventory.archiveRoots.map((root) =>
				archiveRootDocument(inventory, root, canonicalCursor)
			),
			...organizations.map((organization) =>
				organizationDocument(inventory, organization, canonicalCursor)
			),
			...nodes.map((node) =>
				nodeDocument(
					inventory,
					node,
					organizationsById,
					topTierPublicKeys,
					archiveStatusByNodePublicKey,
					canonicalCursor
				)
			)
		],
		generatedAt: inventory.generatedAt,
		networkTime: inventory.network.time
	};
};
