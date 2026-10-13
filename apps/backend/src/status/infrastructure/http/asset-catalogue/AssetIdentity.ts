import { Asset, StrKey } from '@stellar/stellar-sdk';

export interface AssetIdentity {
	readonly id: string;
	readonly kind: 'native' | 'classic' | 'contract';
	readonly code: string | null;
	readonly issuer: string | null;
	readonly contractId: string;
}

export function classicAsset(
	code: string,
	issuer: string,
	network: string
): AssetIdentity {
	if (
		!/^[a-zA-Z0-9]{1,12}$/.test(code) ||
		!StrKey.isValidEd25519PublicKey(issuer)
	)
		throw new Error('Asset requires a valid code and checksum-valid G issuer');
	return {
		id: code + ':' + issuer,
		kind: 'classic',
		code,
		issuer,
		contractId: new Asset(code, issuer).contractId(network)
	};
}

export function nativeAsset(network: string): AssetIdentity {
	return {
		id: 'native',
		kind: 'native',
		code: 'XLM',
		issuer: null,
		contractId: Asset.native().contractId(network)
	};
}

/** Aliases normalize to one identity; an unqualified symbol remains a search. */
export function parseAssetReference(
	reference: string,
	network: string
): AssetIdentity | string {
	const value = reference.trim();
	if (value === 'native' || value === 'XLM') return nativeAsset(network);
	if (StrKey.isValidContract(value))
		return {
			id: value,
			kind: 'contract',
			code: null,
			issuer: null,
			contractId: value
		};
	const parts = value.split(/[:_-]/);
	if (parts.length === 2) {
		if (StrKey.isValidEd25519PublicKey(parts[0]!))
			return classicAsset(parts[1]!, parts[0]!, network);
		return classicAsset(parts[0]!, parts[1]!, network);
	}
	if (/^[a-zA-Z0-9]{1,12}$/.test(value)) return value;
	throw new Error(
		'Use an asset symbol, CODE:ISSUER, native, or checksum-valid C address'
	);
}
