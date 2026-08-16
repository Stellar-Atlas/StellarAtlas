import { err, ok, type Result } from 'neverthrow';
import type { GetNetwork } from '../../use-cases/get-network/GetNetwork.js';
import type { GetKnownNodes } from '../../use-cases/get-known-nodes/GetKnownNodes.js';
import type { GetKnownOrganizations } from '../../use-cases/get-known-organizations/GetKnownOrganizations.js';
import type { NetworkSearchInventory } from './NetworkSearchTypes.js';
import type { GetKnownArchiveEvidence } from '@history-scan-coordinator/use-cases/get-known-archive-evidence/GetKnownArchiveEvidence.js';
import { normalizeHistoryArchiveRootUrl } from 'shared';
import {
	PostgresNetworkSearchCanonicalArchiveSource,
	type NetworkSearchCanonicalArchiveRoot,
	type NetworkSearchCanonicalArchiveSource
} from './NetworkSearchCanonicalArchiveSource.js';

interface NetworkSearchInventoryLoaderConfig {
	readonly canonicalArchiveSource?: NetworkSearchCanonicalArchiveSource;
	readonly getKnownNodes: GetKnownNodes;
	readonly getKnownOrganizations: GetKnownOrganizations;
	readonly getNetwork: GetNetwork;
	readonly getKnownArchiveEvidence: GetKnownArchiveEvidence;
}

export class NetworkSearchInventoryLoader {
	private readonly canonicalArchiveSource: NetworkSearchCanonicalArchiveSource;
	private pending:
		Promise<Result<NetworkSearchInventory | null, Error>> | undefined;

	constructor(private readonly config: NetworkSearchInventoryLoaderConfig) {
		this.canonicalArchiveSource =
			config.canonicalArchiveSource ??
			new PostgresNetworkSearchCanonicalArchiveSource();
	}

	load(): Promise<Result<NetworkSearchInventory | null, Error>> {
		if (this.pending) return this.pending;

		const pending = this.loadCanonical().finally(() => {
			if (this.pending === pending) this.pending = undefined;
		});
		this.pending = pending;
		return pending;
	}

	private async loadCanonical(): Promise<
		Result<NetworkSearchInventory | null, Error>
	> {
		try {
			const [
				networkOrError,
				nodesOrError,
				organizationsOrError,
				canonicalArchives
			] = await Promise.all([
				this.config.getNetwork.execute({}),
				this.config.getKnownNodes.executeAll(),
				this.config.getKnownOrganizations.executeAll(),
				this.canonicalArchiveSource.load()
			]);
			if (networkOrError.isErr()) return err(networkOrError.error);
			if (nodesOrError.isErr()) return err(nodesOrError.error);
			if (organizationsOrError.isErr()) {
				return err(organizationsOrError.error);
			}
			if (networkOrError.value === null) return ok(null);
			const ownedRoots = collectArchiveRoots(
				nodesOrError.value.nodes,
				canonicalArchives.roots
			);
			const evidenceOrError = await this.config.getKnownArchiveEvidence.execute(
				{
					nodePublicKeys: nodesOrError.value.nodes.map(
						(node) => node.publicKey
					),
					options: {
						copyLimit: 1,
						eventLimit: 1,
						failureLimit: 1,
						objectLimit: 1,
						workerIssueLimit: 1
					},
					roots: ownedRoots,
					sameOrganizationArchiveUrlIdentities: ownedRoots.map(
						(root) => root.archiveUrlIdentity
					)
				}
			);
			if (evidenceOrError.isErr()) return err(evidenceOrError.error);

			return ok({
				archiveRoots: evidenceOrError.value.roots,
				canonicalArchiveRevision: canonicalArchives.revision,
				generatedAt: new Date().toISOString(),
				network: networkOrError.value,
				nodes: nodesOrError.value.nodes,
				organizations: organizationsOrError.value.organizations
			});
		} catch (error: unknown) {
			return err(error instanceof Error ? error : new Error(String(error)));
		}
	}
}

export function collectArchiveRoots(
	nodes: NetworkSearchInventory['nodes'],
	canonicalRoots: readonly NetworkSearchCanonicalArchiveRoot[]
) {
	const roots = new Map<
		string,
		{ archiveUrl: string; archiveUrlIdentity: string; nodePublicKeys: string[] }
	>();
	for (const root of canonicalRoots) {
		const archiveUrl =
			normalizeHistoryArchiveRootUrl(root.archiveUrl) ?? root.archiveUrl;
		const archiveUrlIdentity =
			normalizeHistoryArchiveRootUrl(root.archiveUrlIdentity) ??
			root.archiveUrlIdentity.trim();
		if (!roots.has(archiveUrlIdentity)) {
			roots.set(archiveUrlIdentity, {
				archiveUrl,
				archiveUrlIdentity,
				nodePublicKeys: []
			});
		}
	}
	const ownershipAliases = buildOwnershipAliases(roots);
	for (const knownNode of nodes) {
		const archiveUrl = knownNode.node?.historyUrl
			? normalizeHistoryArchiveRootUrl(knownNode.node.historyUrl)
			: null;
		if (archiveUrl === null) continue;
		const archiveUrlIdentity =
			findOwnedArchiveIdentity(archiveUrl, roots, ownershipAliases) ??
			archiveUrl;
		const current = roots.get(archiveUrlIdentity);
		if (current) current.nodePublicKeys.push(knownNode.publicKey);
		else {
			roots.set(archiveUrlIdentity, {
				archiveUrl,
				archiveUrlIdentity,
				nodePublicKeys: [knownNode.publicKey]
			});
		}
	}
	return [...roots.values()]
		.map((root) => ({
			...root,
			nodePublicKeys: root.nodePublicKeys.toSorted()
		}))
		.toSorted((left, right) =>
			left.archiveUrlIdentity.localeCompare(right.archiveUrlIdentity)
		);
}

function buildOwnershipAliases(
	roots: ReadonlyMap<
		string,
		{ readonly archiveUrl: string; readonly archiveUrlIdentity: string }
	>
): ReadonlyMap<string, ReadonlySet<string>> {
	const aliases = new Map<string, Set<string>>();
	for (const [identity, root] of roots) {
		for (const value of [identity, root.archiveUrl]) {
			const alias = legacyOwnershipAlias(value);
			if (alias === null) continue;
			const identities = aliases.get(alias) ?? new Set<string>();
			identities.add(identity);
			aliases.set(alias, identities);
		}
	}
	return aliases;
}

function findOwnedArchiveIdentity(
	archiveUrl: string,
	roots: ReadonlyMap<string, unknown>,
	aliases: ReadonlyMap<string, ReadonlySet<string>>
): string | null {
	if (roots.has(archiveUrl)) return archiveUrl;
	const alias = legacyOwnershipAlias(archiveUrl);
	if (alias === null) return null;
	const candidates = aliases.get(alias);
	return candidates?.size === 1 ? ([...candidates][0] ?? null) : null;
}

function legacyOwnershipAlias(value: string): string | null {
	const normalized = normalizeHistoryArchiveRootUrl(value);
	if (normalized === null) return null;
	const url = new URL(normalized);
	url.pathname = url.pathname.toLowerCase();
	return url.toString().replace(/\/$/, '');
}
