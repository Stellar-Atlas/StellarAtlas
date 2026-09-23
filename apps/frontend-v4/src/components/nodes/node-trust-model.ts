import type {
	PublicNetwork,
	PublicNode,
	PublicOrganization
} from '../../api/types';
import { getNodeLabel, getOrganizationLabel } from '../../domain/network';
import { collectQuorumValidatorIds } from '../graph/graph-quorum';
import { buildGraphModel, type GraphModel } from '../graph/model';

export interface NodeTrustMember {
	readonly publicKey: string;
	readonly label: string;
	readonly node: PublicNode | null;
	readonly organization: PublicOrganization | null;
}

export function buildNodeTrust(
	network: PublicNetwork,
	publicKey: string,
	node: PublicNode | null
) {
	const nodes = new Map(
		network.nodes.map((candidate) => [candidate.publicKey, candidate])
	);
	if (node) nodes.set(publicKey, node);
	const organizations = new Map(
		network.organizations.map((organization) => [organization.id, organization])
	);
	const member = (key: string): NodeTrustMember => {
		const candidate = nodes.get(key) ?? null;
		return {
			publicKey: key,
			label: candidate ? getNodeLabel(candidate) : key,
			node: candidate,
			organization: candidate?.organizationId
				? (organizations.get(candidate.organizationId) ?? null)
				: null
		};
	};
	const sort = (keys: Iterable<string>) =>
		[...new Set(keys)]
			.filter((key) => key !== publicKey)
			.map(member)
			.sort(
				(a, b) =>
					a.label.localeCompare(b.label, 'en') ||
					a.publicKey.localeCompare(b.publicKey, 'en')
			);
	const trusts = sort(collectQuorumValidatorIds(node?.quorumSet ?? null));
	// Nested members of each advertised quorum set, not trust-of-trust reachability.
	const trustedBy = sort(
		network.nodes
			.filter((candidate) =>
				collectQuorumValidatorIds(candidate.quorumSet).has(publicKey)
			)
			.map((candidate) => candidate.publicKey)
	);
	const related = new Set([
		publicKey,
		...trusts.map((item) => item.publicKey),
		...trustedBy.map((item) => item.publicKey)
	]);
	const graph = buildGraphModel({
		...network,
		nodes: [...nodes.values()].filter((candidate) =>
			related.has(candidate.publicKey)
		)
	});
	const knownKeys = new Set(graph.nodes.map((candidate) => candidate.id));
	const edge = (source: string, target: string) => ({
		id: `${source}:${target}`,
		source,
		target,
		color: '#548fc6',
		opacity: 0.65
	});
	const scopedGraph: GraphModel = {
		...graph,
		nodes: graph.nodes.map((candidate) =>
			candidate.id === publicKey ? { ...candidate, radius: 13 } : candidate
		),
		edges: [
			...trusts
				.filter(
					(item) => knownKeys.has(item.publicKey) && knownKeys.has(publicKey)
				)
				.map((item) => edge(publicKey, item.publicKey)),
			...trustedBy
				.filter(
					(item) => knownKeys.has(item.publicKey) && knownKeys.has(publicKey)
				)
				.map((item) => edge(item.publicKey, publicKey))
		]
	};
	return {
		trusts,
		trustedBy,
		quorumAvailable: node?.quorumSet != null,
		graph: scopedGraph
	};
}

export function trustOrganizations(
	members: readonly NodeTrustMember[]
): PublicOrganization[] {
	return [
		...new Map(
			members.flatMap((member) =>
				member.organization
					? [[member.organization.id, member.organization] as const]
					: []
			)
		).values()
	].sort(
		(a, b) =>
			getOrganizationLabel(a).localeCompare(getOrganizationLabel(b), 'en') ||
			a.id.localeCompare(b.id, 'en')
	);
}
