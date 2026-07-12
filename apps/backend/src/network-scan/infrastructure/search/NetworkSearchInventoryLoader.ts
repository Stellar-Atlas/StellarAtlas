import { err, ok, type Result } from 'neverthrow';
import type { GetNetwork } from '../../use-cases/get-network/GetNetwork.js';
import type { GetKnownNodes } from '../../use-cases/get-known-nodes/GetKnownNodes.js';
import type { GetKnownOrganizations } from '../../use-cases/get-known-organizations/GetKnownOrganizations.js';
import type { NetworkSearchInventory } from './NetworkSearchTypes.js';
import type { GetKnownArchiveEvidence } from '@history-scan-coordinator/use-cases/get-known-archive-evidence/GetKnownArchiveEvidence.js';
import { normalizeHistoryArchiveRootUrl } from 'shared';

interface NetworkSearchInventoryLoaderConfig {
	readonly getKnownNodes: GetKnownNodes;
	readonly getKnownOrganizations: GetKnownOrganizations;
	readonly getNetwork: GetNetwork;
	readonly getKnownArchiveEvidence: GetKnownArchiveEvidence;
}

interface CachedInventory {
	readonly expiresAtMs: number;
	readonly inventory: NetworkSearchInventory;
}

const cacheDurationMs = 5_000;

export class NetworkSearchInventoryLoader {
	private cached: CachedInventory | undefined;
	private pending:
		Promise<Result<NetworkSearchInventory | null, Error>> | undefined;

	constructor(private readonly config: NetworkSearchInventoryLoaderConfig) {}

	load(): Promise<Result<NetworkSearchInventory | null, Error>> {
		if (this.cached && this.cached.expiresAtMs > Date.now()) {
			return Promise.resolve(ok(this.cached.inventory));
		}
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
		const [networkOrError, nodesOrError, organizationsOrError] =
			await Promise.all([
				this.config.getNetwork.execute({}),
				this.config.getKnownNodes.executeAll(),
				this.config.getKnownOrganizations.executeAll()
			]);
		if (networkOrError.isErr()) return err(networkOrError.error);
		if (nodesOrError.isErr()) return err(nodesOrError.error);
		if (organizationsOrError.isErr()) return err(organizationsOrError.error);
		if (networkOrError.value === null) return ok(null);
		const ownedRoots = collectArchiveRoots(nodesOrError.value.nodes);
		const evidenceOrError = await this.config.getKnownArchiveEvidence.execute({
			nodePublicKeys: nodesOrError.value.nodes.map((node) => node.publicKey),
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
		});
		if (evidenceOrError.isErr()) return err(evidenceOrError.error);

		const inventory: NetworkSearchInventory = {
			archiveRoots: evidenceOrError.value.roots,
			generatedAt: new Date().toISOString(),
			network: networkOrError.value,
			nodes: nodesOrError.value.nodes,
			organizations: organizationsOrError.value.organizations
		};
		this.cached = {
			expiresAtMs: Date.now() + cacheDurationMs,
			inventory
		};
		return ok(inventory);
	}
}

function collectArchiveRoots(nodes: NetworkSearchInventory['nodes']) {
	const roots = new Map<
		string,
		{ archiveUrl: string; archiveUrlIdentity: string; nodePublicKeys: string[] }
	>();
	for (const knownNode of nodes) {
		const archiveUrl = knownNode.node?.historyUrl
			? normalizeHistoryArchiveRootUrl(knownNode.node.historyUrl)
			: null;
		if (archiveUrl === null) continue;
		const current = roots.get(archiveUrl);
		if (current) current.nodePublicKeys.push(knownNode.publicKey);
		else {
			roots.set(archiveUrl, {
				archiveUrl,
				archiveUrlIdentity: archiveUrl,
				nodePublicKeys: [knownNode.publicKey]
			});
		}
	}
	return [...roots.values()].map((root) => ({
		...root,
		nodePublicKeys: root.nodePublicKeys.toSorted()
	}));
}
