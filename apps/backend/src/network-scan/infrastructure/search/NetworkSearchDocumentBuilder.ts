import { createHash } from 'node:crypto';
import type { NodeV1, OrganizationV1 } from 'shared';
import { networkSearchIndexSchemaVersion } from '@core/config/SearchConfigDefaults.js';
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

const archiveEvidenceFreshnessMs = 24 * 60 * 60 * 1_000;

const isFreshArchiveEvidence = (
	observedAt: string | null | undefined,
	generatedAt: string
): boolean => {
	if (observedAt === null || observedAt === undefined) return false;
	const observedAtMs = Date.parse(observedAt);
	const generatedAtMs = Date.parse(generatedAt);
	return (
		Number.isFinite(observedAtMs) &&
		Number.isFinite(generatedAtMs) &&
		observedAtMs <= generatedAtMs + 5 * 60 * 1_000 &&
		generatedAtMs - observedAtMs <= archiveEvidenceFreshnessMs
	);
};

const currentArchiveEvidenceStatus = (
	root: NetworkSearchInventory['archiveRoots'][number],
	generatedAt: string
): NetworkSearchDocument['archiveStatus'] => {
	const stateIsFresh = isFreshArchiveEvidence(
		root.scannerOwnedState?.observedAt,
		generatedAt
	);
	if (stateIsFresh && root.scannerOwnedState?.status === 'unreachable') {
		return 'unreachable';
	}
	if (stateIsFresh && root.scannerOwnedState?.status === 'invalid') {
		return 'error';
	}
	if (
		root.checkpoints.mismatchedCheckpoints > 0 ||
		root.objects.remoteFailureObjects > 0
	)
		return 'error';
	if (root.objects.workerIssueObjects > 0) return 'scanner-issue';
	const objectEvidenceIsFresh = isFreshArchiveEvidence(
		root.latestObjectAt,
		generatedAt
	);
	if (
		(stateIsFresh && root.scannerOwnedState?.status === 'available') ||
		(objectEvidenceIsFresh && root.checkpoints.verifiedCheckpoints > 0)
	) {
		return 'ok';
	}
	return 'unknown';
};

const archiveStatusPriority = (
	status: NetworkSearchDocument['archiveStatus']
): number => {
	if (status === 'error') return 5;
	if (status === 'unreachable') return 4;
	if (status === 'scanner-issue') return 3;
	if (status === 'ok') return 2;
	return 1;
};

const buildArchiveStatusByNodePublicKey = (
	roots: NetworkSearchInventory['archiveRoots'],
	generatedAt: string
): ReadonlyMap<string, NetworkSearchDocument['archiveStatus']> => {
	const statuses = new Map<string, NetworkSearchDocument['archiveStatus']>();
	for (const root of roots) {
		const status = currentArchiveEvidenceStatus(root, generatedAt);
		for (const publicKey of root.nodePublicKeys) {
			const existing = statuses.get(publicKey);
			if (
				existing === undefined ||
				archiveStatusPriority(status) > archiveStatusPriority(existing)
			) {
				statuses.set(publicKey, status);
			}
		}
	}
	return statuses;
};

const normalizeHomeDomain = (
	value: string | null | undefined
): string | null => {
	const normalized = value?.trim().toLowerCase().replace(/\.$/, '');
	return normalized && normalized !== 'unknown' ? normalized : null;
};

const buildOrganizationIdByNodePublicKey = (
	nodes: readonly KnownNodeListItemDTO[],
	organizations: readonly KnownOrganizationListItemDTO[]
): ReadonlyMap<string, string> => {
	const organizationIds = new Set(
		organizations.map(({ organization }) => organization.id)
	);
	const organizationByValidator = new Map<string, string | null>();
	const organizationByHomeDomain = new Map<string, string | null>();
	for (const { organization } of organizations) {
		for (const publicKey of organization.validators) {
			setUniqueOrganizationOwner(
				organizationByValidator,
				publicKey,
				organization.id
			);
		}
		const homeDomain = normalizeHomeDomain(organization.homeDomain);
		if (homeDomain !== null) {
			setUniqueOrganizationOwner(
				organizationByHomeDomain,
				homeDomain,
				organization.id
			);
		}
	}

	const result = new Map<string, string>();
	for (const knownNode of nodes) {
		const explicitId = knownNode.node?.organizationId ?? null;
		const validatorOrganizationId = organizationByValidator.get(
			knownNode.publicKey
		);
		const inheritedId =
			validatorOrganizationId !== undefined
				? validatorOrganizationId
				: organizationByHomeDomain.get(
						normalizeHomeDomain(knownNode.node?.homeDomain) ?? ''
					);
		const organizationId =
			explicitId !== null && organizationIds.has(explicitId)
				? explicitId
				: inheritedId;
		if (organizationId !== undefined && organizationId !== null) {
			result.set(knownNode.publicKey, organizationId);
		}
	}
	return result;
};

const setUniqueOrganizationOwner = (
	owners: Map<string, string | null>,
	key: string,
	organizationId: string
): void => {
	const existing = owners.get(key);
	if (existing === undefined) owners.set(key, organizationId);
	else if (existing !== organizationId) owners.set(key, null);
};

const buildArchiveStatusByOrganizationId = (
	archiveStatusByNodePublicKey: ReadonlyMap<
		string,
		NetworkSearchDocument['archiveStatus']
	>,
	organizationIdByNodePublicKey: ReadonlyMap<string, string>
): ReadonlyMap<string, NetworkSearchDocument['archiveStatus']> => {
	const result = new Map<string, NetworkSearchDocument['archiveStatus']>();
	for (const [publicKey, organizationId] of organizationIdByNodePublicKey) {
		const status = archiveStatusByNodePublicKey.get(publicKey) ?? 'unknown';
		const existing = result.get(organizationId);
		if (
			existing === undefined ||
			archiveStatusPriority(status) > archiveStatusPriority(existing)
		) {
			result.set(organizationId, status);
		}
	}
	return result;
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
	organizationIdByNodePublicKey: ReadonlyMap<string, string>,
	canonicalCursor: string
): NetworkSearchDocument => {
	const node = knownNode.node;
	const organizationId = organizationIdByNodePublicKey.get(knownNode.publicKey);
	const organization = organizationId
		? organizationsById.get(organizationId)
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
		organizationId,
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
	archiveStatusByOrganizationId: ReadonlyMap<
		string,
		NetworkSearchDocument['archiveStatus']
	>,
	canonicalCursor: string
): NetworkSearchDocument => {
	const organization = knownOrganization.organization;
	const label = organizationLabel(organization);
	const detail = text(organization.homeDomain) ?? organization.id;

	return {
		active: knownOrganization.current && organization.validators.length > 0,
		archiveStatus:
			archiveStatusByOrganizationId.get(organization.id) ?? 'unknown',
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
	const host = new URL(root.archiveUrl).host;
	return {
		active: true,
		archiveStatus: currentArchiveEvidenceStatus(root, inventory.generatedAt),
		canonicalCursor,
		content: joinSearchText(host, root.archiveUrl, ...root.nodePublicKeys),
		detail: root.archiveUrl,
		documentKind: 'entity',
		entityId: root.archiveUrlIdentity,
		entityType: 'archive-root',
		href: `/archive-scans/${encodeURIComponent(root.archiveUrl)}`,
		id: safeDocumentId('archive', root.archiveUrlIdentity),
		indexedAt: inventory.generatedAt,
		label: host,
		latestLedger: inventory.network.latestLedger,
		networkTime: inventory.network.time,
		observedAt: inventory.network.time,
		recordState: 'current',
		scope: 'archive-root'
	};
};

export const buildNetworkSearchSnapshot = (
	inventory: NetworkSearchInventory
): NetworkSearchSnapshot => {
	const archiveRoots = inventory.archiveRoots.toSorted((left, right) =>
		left.archiveUrlIdentity.localeCompare(right.archiveUrlIdentity)
	);
	const nodes = inventory.nodes.toSorted((left, right) =>
		left.publicKey.localeCompare(right.publicKey)
	);
	const organizations = inventory.organizations.toSorted((left, right) =>
		left.organization.id.localeCompare(right.organization.id)
	);
	const archiveRootSearchState = archiveRoots.map((root) => ({
		archiveStatus: currentArchiveEvidenceStatus(root, inventory.generatedAt),
		archiveUrl: root.archiveUrl,
		archiveUrlIdentity: root.archiveUrlIdentity,
		nodePublicKeys: root.nodePublicKeys.toSorted()
	}));
	const canonicalCursor = createHash('sha256')
		.update(
			JSON.stringify({
				archiveRoots: archiveRootSearchState,
				canonicalArchiveRevision: inventory.canonicalArchiveRevision,
				documentSchemaVersion: networkSearchIndexSchemaVersion,
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
		archiveRoots,
		inventory.generatedAt
	);
	const organizationIdByNodePublicKey = buildOrganizationIdByNodePublicKey(
		nodes,
		organizations
	);
	const archiveStatusByOrganizationId = buildArchiveStatusByOrganizationId(
		archiveStatusByNodePublicKey,
		organizationIdByNodePublicKey
	);

	return {
		canonicalArchiveRevision: inventory.canonicalArchiveRevision,
		canonicalCursor,
		documentSchemaVersion: networkSearchIndexSchemaVersion,
		documents: [
			...archiveRoots.map((root) =>
				archiveRootDocument(inventory, root, canonicalCursor)
			),
			...organizations.map((organization) =>
				organizationDocument(
					inventory,
					organization,
					archiveStatusByOrganizationId,
					canonicalCursor
				)
			),
			...nodes.map((node) =>
				nodeDocument(
					inventory,
					node,
					organizationsById,
					topTierPublicKeys,
					archiveStatusByNodePublicKey,
					organizationIdByNodePublicKey,
					canonicalCursor
				)
			)
		],
		generatedAt: inventory.generatedAt,
		networkTime: inventory.network.time
	};
};
