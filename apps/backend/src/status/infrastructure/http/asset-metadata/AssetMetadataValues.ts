import { rm, stat, statfs } from 'node:fs/promises';
import type {
	AssetMetadata,
	AssetMetadataInput,
	CurrencyEntry,
	IssuerMetadata
} from './types.js';
export interface PersistedIssuer extends IssuerMetadata {
	readonly logoFiles: Readonly<Record<string, string>>;
}
type LogoExtension = 'png' | 'jpg' | 'webp' | 'gif';
const logoMaxBytes = 2 * 1024 * 1024;

export function findCurrency(
	currencies: readonly CurrencyEntry[],
	input: Pick<AssetMetadataInput, 'code' | 'issuer' | 'contractId'>
): CurrencyEntry | null {
	if (input.code && input.issuer) {
		return (
			currencies.find(
				(currency) =>
					currency.code === input.code && currency.issuer === input.issuer
			) ?? null
		);
	}
	if (input.contractId) {
		return (
			currencies.find((currency) => currency.contract === input.contractId) ??
			null
		);
	}
	if (!input.code || !input.issuer) return null;
	return (
		currencies.find(
			(currency) =>
				currency.code === input.code && currency.issuer === input.issuer
		) ?? null
	);
}

export function detectLogoExtension(body: Buffer): LogoExtension | null {
	if (body.length < 4 || body.length > logoMaxBytes) return null;
	if (
		body.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
	)
		return 'png';
	if (body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) return 'jpg';
	if (body.toString('ascii', 0, 4) === 'GIF8') return 'gif';
	if (
		body.toString('ascii', 0, 4) === 'RIFF' &&
		body.toString('ascii', 8, 12) === 'WEBP'
	)
		return 'webp';
	return null;
}

export function pending(
	id: string,
	homeDomain: string | null,
	error: string | null,
	tomlUrl: string | null = null
): AssetMetadata {
	return { ...unavailable(id, homeDomain, error), status: 'pending', tomlUrl };
}

export function unavailable(
	id: string,
	homeDomain: string | null,
	error: string | null
): AssetMetadata {
	return {
		id,
		status: 'unavailable',
		name: null,
		description: null,
		homeDomain,
		tomlUrl: null,
		logoUrl: null,
		organization: {},
		fetchedAt: null,
		error
	};
}

export function organizationFromIssuerFields(
	fields: Readonly<Record<string, string>>
): Readonly<Record<string, string>> {
	const organization: Record<string, string> = {};
	for (const [key, value] of Object.entries(fields)) {
		if (key.startsWith('ORG_'))
			organization[key.slice(4).toLowerCase()] = value;
		else if (key.startsWith('DOCUMENTATION.ORG_'))
			organization[
				`documentation.${key.slice('DOCUMENTATION.ORG_'.length).toLowerCase()}`
			] = value;
	}
	return organization;
}

export function emptyIssuer(
	homeDomain: string,
	tomlUrl: string,
	networkPassphrase: string,
	at: string
): PersistedIssuer {
	return {
		homeDomain,
		tomlUrl,
		networkPassphrase,
		currencies: [],
		fields: {},
		fetchedAt: at,
		etag: null,
		lastModified: null,
		error: null,
		lastAttemptAt: at,
		logoFiles: {}
	};
}

export function isPersistedIssuer(
	value: unknown,
	homeDomain: string,
	network: string
): value is PersistedIssuer {
	return (
		isRecord(value) &&
		value.homeDomain === homeDomain &&
		value.networkPassphrase === network &&
		Array.isArray(value.currencies) &&
		isRecord(value.fields) &&
		isRecord(value.logoFiles) &&
		typeof value.fetchedAt === 'string'
	);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function safeError(error: unknown): string {
	if (isCacheSpaceError(error)) return cacheSpaceErrorMessage;
	if (
		error instanceof Error &&
		/^Issuer TOML returned HTTP \d{3}$/.test(error.message)
	)
		return error.message;
	if (
		error instanceof Error &&
		error.message === 'Issuer TOML network passphrase does not match'
	)
		return error.message;
	return 'Issuer metadata refresh failed';
}

export function isCode(error: unknown, code: string): boolean {
	return isRecord(error) && error.code === code;
}

export function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function removeExpiredLock(
	path: string,
	now: number,
	staleAfterMs: number
): Promise<boolean> {
	try {
		const before = await stat(path);
		if (now - before.mtimeMs <= staleAfterMs) return false;
		const after = await stat(path);
		if (
			before.dev !== after.dev ||
			before.ino !== after.ino ||
			now - after.mtimeMs <= staleAfterMs
		)
			return false;
		await rm(path);
		return true;
	} catch {
		return false;
	}
}

interface CacheFilesystemStats {
	readonly bsize: number;
	readonly blocks: number;
	readonly bavail: number;
}

type CacheStatfs = (path: string) => Promise<CacheFilesystemStats>;

export const cacheSpaceErrorMessage = 'metadata cache low on space';

export function isCacheSpaceError(error: unknown): boolean {
	return error instanceof Error && error.message === cacheSpaceErrorMessage;
}

export function issuerTomlUrl(homeDomain: string): string {
	const value = homeDomain.trim();
	const url = new URL(value.includes('://') ? value : `https://${value}`);
	if (
		url.protocol !== 'https:' ||
		url.pathname !== '/' ||
		url.search ||
		url.hash ||
		url.username ||
		url.password ||
		url.port
	) {
		throw new Error('Issuer home domain must be a hostname only');
	}
	return `https://${url.hostname}/.well-known/stellar.toml`;
}

export async function assertCacheSpace(
	root: string,
	incomingBytes: number,
	statfsImpl: CacheStatfs = async (path) => statfs(path)
): Promise<void> {
	try {
		const { bsize, blocks, bavail } = await statfsImpl(root);
		const reserve = Math.max(bsize * blocks * 0.1, 64 * 1024 * 1024);
		if (
			![bsize, blocks, bavail, incomingBytes].every(Number.isFinite) ||
			incomingBytes < 0 ||
			bsize * bavail - incomingBytes <= reserve
		)
			throw new Error(cacheSpaceErrorMessage);
	} catch (error) {
		if (error instanceof Error && error.message === cacheSpaceErrorMessage)
			throw error;
		throw new Error(cacheSpaceErrorMessage);
	}
}
