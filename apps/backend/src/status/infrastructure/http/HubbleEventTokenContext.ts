import { Networks, StrKey } from '@stellar/stellar-sdk';
import { classicAsset, nativeAsset } from './asset-catalogue/AssetIdentity.js';

export interface HubbleEventTokenContext {
	readonly contractId: string;
	readonly assetId: string;
	readonly symbol: string;
	readonly decimals: 7;
}

/** CAP-67 identity proof only: no metadata, RPC, warehouse lookup or retained cache.
 * https://github.com/stellar/stellar-protocol/blob/master/core/cap-0067.md
 */
export function eventTokenContext(row: Readonly<Record<string, unknown>>): HubbleEventTokenContext | null {
	if (row.type !== 1 || typeof row.contract_id !== 'string') return null;
	const topics = decoded(row.topics_decoded);
	if (!Array.isArray(topics) || topics.length < 3 || topics.length > 4) return null;
	const action = text(topics[0], 'symbol');
	if (!['mint', 'burn', 'clawback', 'transfer'].includes(action ?? '') ||
		topics.length !== (action === 'transfer' ? 4 : 3)) return null;
	for (const topic of topics.slice(1, -1)) {
		const address = text(topic, 'address');
		if (!address || address.length !== 56 || !(StrKey.isValidEd25519PublicKey(address) || StrKey.isValidContract(address))) return null;
	}
	const reference = text(topics.at(-1), 'string');
	if (!reference || reference.length > 69) return null;
	try {
		const parts = reference.split(':');
		const asset = reference === 'native' ? nativeAsset(Networks.PUBLIC)
			: parts.length === 2 ? classicAsset(parts[0]!, parts[1]!, Networks.PUBLIC) : null;
		if (!asset || asset.contractId !== row.contract_id) return null;
		return { contractId: asset.contractId, assetId: asset.id, symbol: asset.code!, decimals: 7 };
	} catch { return null; }
}

function decoded(value: unknown): unknown {
	if (typeof value !== 'string') return value;
	if (value.length > 4096) return null;
	try { return JSON.parse(value) as unknown; } catch { return null; }
}

function text(value: unknown, key: string): string | null {
	const node = decoded(value);
	if (!node || typeof node !== 'object' || Array.isArray(node) || Object.keys(node).length !== 1) return null;
	const field: unknown = (node as Readonly<Record<string, unknown>>)[key];
	return typeof field === 'string' ? field : null;
}
