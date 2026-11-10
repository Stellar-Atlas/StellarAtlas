import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { StrKey } from '@stellar/stellar-sdk';
import validator from 'validator';

export const EXPERT_DIRECTORY_SOURCE = 'stellar-expert/public-directory';
export const MAX_EXPERT_RECORD_BYTES = 8 * 1024;
const MAX_TAGS = 24;

export interface DirectoryAddress {
	readonly address: string;
	readonly addressKind: 'account' | 'contract';
}

export interface DirectoryPublicFields {
	readonly name: string;
	readonly domain: string | null;
	readonly tags: readonly string[];
}

export interface ExpertDirectoryRecord
	extends DirectoryAddress, DirectoryPublicFields {
	readonly source: typeof EXPERT_DIRECTORY_SOURCE;
	readonly publisher: 'StellarExpert';
	readonly license: 'MIT';
	readonly networkApplicability: 'unspecified';
	readonly sourcePath: string;
	readonly sourceBlobOid: string;
	readonly contentSha256: string;
	readonly version: number;
}

export function isGitOid(value: unknown): value is string {
	return (
		typeof value === 'string' &&
		value.length === 40 &&
		/^[0-9a-f]+$/.test(value)
	);
}

export function parseDirectoryAddress(value: unknown): DirectoryAddress {
	if (typeof value === 'string' && value.length === 56) {
		if (StrKey.isValidEd25519PublicKey(value))
			return { address: value, addressKind: 'account' };
		if (StrKey.isValidContract(value))
			return { address: value, addressKind: 'contract' };
	}
	throw new Error('Invalid directory address');
}

export function parseExpertDirectoryPath(path: string): DirectoryAddress {
	if (
		typeof path !== 'string' ||
		path.length !== 70 ||
		!/^accounts\/[GC][A-Z2-7]{55}\.json$/.test(path)
	)
		throw new Error('Invalid directory record path');
	return parseDirectoryAddress(path.slice(9, -5));
}

export function normalizeDirectoryPublicFields(input: {
	readonly name?: unknown;
	readonly domain?: unknown;
	readonly tags?: unknown;
}): DirectoryPublicFields {
	const name = typeof input.name === 'string' ? input.name.trim() : '';
	if (
		!name ||
		name.length > 160 ||
		/[<>\p{Cc}\p{Zl}\p{Zp}\u202A-\u202E\u2066-\u2069]/u.test(name)
	)
		throw new Error('Invalid directory display name');
	const domain =
		input.domain === undefined || input.domain === null
			? null
			: normalizeDomain(input.domain);
	if (!Array.isArray(input.tags) || input.tags.length > MAX_TAGS)
		throw new Error('Invalid directory tags');
	const tags = new Set<string>();
	for (const tag of input.tags as unknown[]) {
		if (
			typeof tag !== 'string' ||
			tag.length > 40 ||
			!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$(?!\s)/.test(tag)
		)
			throw new Error('Invalid directory tag');
		tags.add(tag);
	}
	return { name, domain, tags: [...tags].sort() };
}

export function parseExpertDirectoryRecord(
	path: string,
	blobOid: string,
	bytes: Uint8Array
): ExpertDirectoryRecord {
	const identity = parseExpertDirectoryPath(path);
	if (
		!isGitOid(blobOid) ||
		!(bytes instanceof Uint8Array) ||
		bytes.byteLength < 1 ||
		bytes.byteLength > MAX_EXPERT_RECORD_BYTES
	)
		throw new Error('Invalid directory blob');
	const payload = Buffer.from(bytes);
	const expected = createHash('sha1')
		.update(`blob ${payload.byteLength}\0`)
		.update(payload)
		.digest('hex');
	if (blobOid !== expected)
		throw new Error('Directory blob does not match its Git identity');
	const decoded: unknown = JSON.parse(
		new TextDecoder('utf-8', { fatal: true }).decode(payload)
	);
	if (!isRecord(decoded) || decoded.address !== identity.address)
		throw new Error('Directory record does not match its path');
	const version = decoded.version;
	if (
		typeof version !== 'number' ||
		!Number.isSafeInteger(version) ||
		version < 0
	)
		throw new Error('Invalid directory record version');
	const fields =
		version === 0 && typeof decoded.domain === 'string'
			? { ...decoded, domain: parseDnsHostname(decoded.domain) }
			: decoded;
	return {
		...identity,
		...normalizeDirectoryPublicFields(fields),
		source: EXPERT_DIRECTORY_SOURCE,
		publisher: 'StellarExpert',
		license: 'MIT',
		networkApplicability: 'unspecified',
		sourcePath: path,
		sourceBlobOid: blobOid,
		contentSha256: createHash('sha256').update(payload).digest('hex'),
		version
	};
}

function normalizeDomain(value: unknown): string {
	const host = parseDnsHostname(value);
	if (host === null) throw new Error('Invalid directory DNS hostname');
	return host;
}

/** Legacy upstream records may contain annotations in this optional field. */
function parseDnsHostname(value: unknown): string | null {
	if (
		typeof value !== 'string' ||
		value.length > 254 ||
		!/^[A-Za-z0-9.-]+$(?!\s)/.test(value)
	)
		return null;
	const host = value.toLowerCase().replace(/\.$/, '');
	try {
		if (
			isIP(host) === 0 &&
			validator.isFQDN(host) &&
			new URL('https://' + host).hostname === host
		)
			return host;
	} catch {
		// URL parser aliases do not establish a DNS hostname.
	}
	return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
