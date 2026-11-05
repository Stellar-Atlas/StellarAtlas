import { keccak_256 } from '@noble/hashes/sha3.js';
import { Address, StrKey, xdr } from '@stellar/stellar-sdk';

// Creit Tech Soroban Domains SDK mainnet Registry v2 deployment.
export const REGISTRY_V2 =
	'CC75Z72OCE667WVPQOROIWDAGBOXFNJ4VQONQEURL74EYIDLWA4F7FEN';

export interface ExactDomainName {
	readonly name: string;
	readonly labels: readonly string[];
	readonly nodes: readonly Uint8Array[];
}

// Four labels before the suffix is the Explorer lookup limit.
export function exactDomainName(input: string): ExactDomainName | null {
	if (
		input.length > 67 ||
		!/^(?:[A-Za-z]{1,15}\.){1,4}[Xx][Ll][Mm]$(?!\s)/.test(input)
	)
		return null;
	const name = input.toLowerCase();
	const labels = name.split('.').slice(0, -1).reverse();
	let parent: Uint8Array = Buffer.from('xlm');
	const nodes = labels.map((label) => {
		parent = keccak_256(
			Buffer.concat([keccak_256(parent), keccak_256(Buffer.from(label))])
		);
		return parent;
	});
	return { name, labels, nodes };
}

export function registryRecordKey(domain: ExactDomainName): xdr.ScVal {
	return xdr.ScVal.scvVec([
		xdr.ScVal.scvSymbol(domain.nodes.length === 1 ? 'Domain' : 'SubDomain'),
		xdr.ScVal.scvBytes(domain.nodes.at(-1)!)
	]);
}

export interface SorobanDomainRecord {
	readonly address: string;
	readonly addressKind: 'account' | 'contract';
	readonly node: string;
	readonly kind: 'domain' | 'subdomain';
	readonly expiresAt: number;
}

export function decodeRegistryRecord(
	domain: ExactDomainName,
	value: xdr.ScVal
): SorobanDomainRecord {
	const tuple = value.type === 'scvVec' ? value.vec : null;
	if (tuple?.length !== 2) throw new Error('Invalid registry record tuple');
	const [root, sub] = tuple;
	const rootFields = fields(root!, 7);
	assertBytes(rootFields.get('domain'), Buffer.from(domain.labels[0]!));
	assertBytes(rootFields.get('tld'), Buffer.from('xlm'));
	assertBytes(rootFields.get('node'), domain.nodes[0]!);
	if (rootFields.get('token_id')?.type !== 'scvU32')
		throw new Error('Invalid registry token ID');
	const snapshot = readU64(rootFields.get('snapshot'));
	const expiresAt = Number(readU64(rootFields.get('exp_date')));
	if (!Number.isSafeInteger(expiresAt * 1000) || expiresAt <= 0)
		throw new Error('Invalid registry expiration');
	let address = readAddress(rootFields.get('address'));
	const isSubdomain = domain.nodes.length > 1;
	if (isSubdomain) {
		const subFields = fields(sub!, 6);
		assertBytes(subFields.get('domain'), Buffer.from(domain.labels.at(-1)!));
		assertBytes(subFields.get('node'), domain.nodes.at(-1)!);
		assertBytes(subFields.get('parent'), domain.nodes.at(-2)!);
		assertBytes(subFields.get('root'), domain.nodes[0]!);
		if (readU64(subFields.get('snapshot')) !== snapshot)
			throw new Error('Registry subdomain snapshot mismatch');
		address = readAddress(subFields.get('address'));
	} else if (sub?.type !== 'scvVoid') {
		throw new Error('Unexpected subdomain in root record');
	}
	return {
		address,
		addressKind: StrKey.isValidContract(address) ? 'contract' : 'account',
		node: Buffer.from(domain.nodes.at(-1)!).toString('hex'),
		kind: isSubdomain ? 'subdomain' : 'domain',
		expiresAt
	};
}

function fields(value: xdr.ScVal, count: number): Map<string, xdr.ScVal> {
	const entries = value.type === 'scvMap' ? value.map : null;
	if (entries?.length !== count) throw new Error('Invalid registry record map');
	const result = new Map<string, xdr.ScVal>();
	for (const { key, val } of entries) {
		if (key.type !== 'scvSymbol' || result.has(key.sym.toString()))
			throw new Error('Invalid registry record field');
		result.set(key.sym.toString(), val);
	}
	return result;
}

function assertBytes(value: xdr.ScVal | undefined, expected: Uint8Array): void {
	if (
		value?.type !== 'scvBytes' ||
		!Buffer.from(value.bytes.value).equals(expected)
	)
		throw new Error('Registry record does not match the requested name');
}

function readU64(value: xdr.ScVal | undefined): bigint {
	if (value?.type !== 'scvU64') throw new Error('Invalid registry u64');
	return BigInt(value.u64.toString());
}

function readAddress(value: xdr.ScVal | undefined): string {
	if (
		value?.type !== 'scvAddress' ||
		(value.address.type !== 'scAddressTypeAccount' &&
			value.address.type !== 'scAddressTypeContract')
	)
		throw new Error('Invalid registry destination');
	const address = Address.fromScAddress(value.address).toString();
	if (
		!StrKey.isValidContract(address) &&
		!StrKey.isValidEd25519PublicKey(address)
	)
		throw new Error('Invalid registry destination checksum');
	return address;
}
