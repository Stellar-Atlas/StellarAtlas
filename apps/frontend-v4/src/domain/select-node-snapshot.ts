import type { PublicNetwork, PublicNode } from '../api/types';

/** Current network metadata wins; retained snapshots serve historical-only keys. */
export function selectNodeSnapshot(
	network: PublicNetwork,
	publicKey: string,
	retained: PublicNode | null
): PublicNode | null {
	return network.nodes.find((node) => node.publicKey === publicKey) ?? retained;
}
