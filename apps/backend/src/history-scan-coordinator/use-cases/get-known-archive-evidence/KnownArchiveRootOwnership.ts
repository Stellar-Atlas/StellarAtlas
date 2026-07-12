import type { NodeRepository } from '@network-scan/domain/node/NodeRepository.js';
import type { KnownOrganizationDTO } from '@network-scan/use-cases/get-known-organizations/GetKnownOrganizationsDTO.js';
import {
	getHistoryArchiveUrlIdentity,
	parseHistoryArchiveUrl
} from '../../domain/ArchiveUrlIdentity.js';
import type { OwnedKnownArchiveRoot } from './GetKnownArchiveEvidence.js';

export interface KnownArchiveNodeOwnership {
	readonly historyUrl: string | null;
	readonly publicKey: string;
}

export interface KnownOrganizationArchiveOwnership {
	readonly nodePublicKeys: readonly string[];
	readonly roots: readonly OwnedKnownArchiveRoot[];
}

export function getOwnedKnownArchiveRoots(
	nodes: readonly KnownArchiveNodeOwnership[]
): readonly OwnedKnownArchiveRoot[] {
	const roots = new Map<
		string,
		{ archiveUrl: string; nodePublicKeys: Set<string> }
	>();

	for (const node of nodes) {
		if (node.historyUrl === null) continue;
		const archiveUrl = parseHistoryArchiveUrl(node.historyUrl);
		if (archiveUrl === null) continue;
		const archiveUrlIdentity = getHistoryArchiveUrlIdentity(archiveUrl);
		if (archiveUrlIdentity === null) continue;
		const existing = roots.get(archiveUrlIdentity);
		if (existing === undefined) {
			roots.set(archiveUrlIdentity, {
				archiveUrl,
				nodePublicKeys: new Set([node.publicKey])
			});
		} else {
			existing.nodePublicKeys.add(node.publicKey);
		}
	}

	return Array.from(roots.entries())
		.map(([archiveUrlIdentity, root]) => ({
			archiveUrl: root.archiveUrl,
			archiveUrlIdentity,
			nodePublicKeys: Array.from(root.nodePublicKeys).toSorted()
		}))
		.toSorted((left, right) =>
			left.archiveUrlIdentity.localeCompare(right.archiveUrlIdentity)
		);
}

export function mergeOwnedKnownArchiveRoots(
	...rootSets: readonly (readonly OwnedKnownArchiveRoot[])[]
): readonly OwnedKnownArchiveRoot[] {
	return getOwnedKnownArchiveRoots(
		rootSets.flatMap((roots) =>
			roots.flatMap((root) =>
				root.nodePublicKeys.map((publicKey) => ({
					historyUrl: root.archiveUrl,
					publicKey
				}))
			)
		)
	);
}

export async function getKnownOrganizationArchiveOwnership(
	knownOrganization: KnownOrganizationDTO,
	nodeRepository: NodeRepository
): Promise<KnownOrganizationArchiveOwnership> {
	const validatorPublicKeys = new Set(
		knownOrganization.organization.validators
	);
	const organizationHomeDomain = normalizeHomeDomain(
		knownOrganization.organization.homeDomain
	);
	const nodes = (await nodeRepository.findAllKnown()).filter(
		(node) =>
			validatorPublicKeys.has(node.publicKey.value) ||
			(organizationHomeDomain !== null &&
				normalizeHomeDomain(node.homeDomain) === organizationHomeDomain)
	);
	const nodePublicKeys = [
		...new Set([
			...validatorPublicKeys,
			...nodes.map((node) => node.publicKey.value)
		])
	].toSorted();
	const roots = getOwnedKnownArchiveRoots(
		nodes.map((node) => ({
			historyUrl: node.details?.historyUrl ?? null,
			publicKey: node.publicKey.value
		}))
	);

	return { nodePublicKeys, roots };
}

function normalizeHomeDomain(value: string | null): string | null {
	if (value === null) return null;
	const normalized = value.trim().toLowerCase().replace(/\.$/, '');
	return normalized.length === 0 || normalized === 'unknown'
		? null
		: normalized;
}
