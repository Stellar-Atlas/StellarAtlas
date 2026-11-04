import { createHash } from 'node:crypto';
import { open, opendir } from 'node:fs/promises';
import { join } from 'node:path';
import { StrKey } from '@stellar/stellar-sdk';
import {
	isRecord,
	issuerTomlUrl
} from '../asset-metadata/AssetMetadataValues.js';

const MAX_DIRECTORY_ENTRIES = 10_000;
const MAX_INDEX_READ_MS = 4_000;
const CACHE_FRESH_MS = 24 * 60 * 60 * 1000;

export function normalizeIssuerDomain(value: string): string | null {
	const input = value.trim();
	if (!/^[A-Za-z0-9.-]+$(?!\s)/.test(input)) return null;
	const host = input.toLowerCase().replace(/\.$/, '');
	const labels = host.split('.');
	if (
		host.length > 253 ||
		labels.length < 2 ||
		labels.at(-1) === 'xlm' ||
		!/[a-z]/.test(labels.at(-1)!) ||
		labels.some(
			(label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)
		)
	)
		return null;
	return host;
}

export interface IndexedDomain {
	readonly homeDomain: string | null;
	readonly observedAt: string | null;
	readonly lastAttemptFailed: boolean;
}

export interface IndexedDomains {
	readonly status: 'available' | 'partial' | 'unavailable';
	readonly byAccount: ReadonlyMap<string, IndexedDomain>;
	readonly byDomain: ReadonlyMap<string, readonly string[]>;
}

export interface CachedDomainToml {
	readonly status: 'available' | 'stale' | 'unavailable';
	readonly url: string | null;
	readonly fetchedAt: string | null;
	readonly accountsIndexed: boolean;
	readonly accounts: ReadonlySet<string>;
	readonly currencies: ReadonlyMap<string, ReadonlySet<string>>;
}

export class IssuerDomainCache {
	constructor(
		private readonly root: string,
		private readonly network: string
	) {}

	async readIndexedDomains(): Promise<IndexedDomains> {
		const byAccount = new Map<string, IndexedDomain>();
		const byDomain = new Map<string, string[]>();
		let status: IndexedDomains['status'] = 'unavailable';
		const started = performance.now();
		try {
			const directory = await opendir(join(this.root, 'issuer-domains'));
			status = 'available';
			let visited = 0;
			for await (const entry of directory) {
				if (
					++visited > MAX_DIRECTORY_ENTRIES ||
					performance.now() - started >= MAX_INDEX_READ_MS
				) {
					status = 'partial';
					break;
				}
				if (!entry.isFile() || !/^[a-f0-9]{64}\.json$/.test(entry.name))
					continue;
				const raw = await readCacheJson(
					join(this.root, 'issuer-domains', entry.name),
					16 * 1024
				);
				if (raw === null) status = 'partial';
				if (
					!isRecord(raw) ||
					typeof raw.issuer !== 'string' ||
					!StrKey.isValidEd25519PublicKey(raw.issuer) ||
					entry.name !== this.cacheKey(raw.issuer) + '.json' ||
					!(typeof raw.homeDomain === 'string' || raw.homeDomain === null) ||
					typeof raw.error !== 'boolean'
				)
					continue;
				const homeDomain =
					raw.homeDomain === null
						? null
						: normalizeIssuerDomain(raw.homeDomain);
				const observedAt = timestamp(raw.fetchedAt);
				byAccount.set(raw.issuer, {
					homeDomain,
					observedAt,
					lastAttemptFailed: raw.error
				});
				if (!homeDomain) continue;
				const matches = byDomain.get(homeDomain) ?? [];
				matches.push(raw.issuer);
				byDomain.set(homeDomain, matches);
			}
		} catch {
			status = byAccount.size > 0 ? 'partial' : 'unavailable';
		}
		return { status, byAccount, byDomain };
	}

	async readToml(domain: string, now: number): Promise<CachedDomainToml> {
		const empty = {
			status: 'unavailable' as const,
			url: null,
			fetchedAt: null,
			accountsIndexed: false,
			accounts: new Set<string>(),
			currencies: new Map<string, Set<string>>()
		};
		const raw = await readCacheJson(
			join(this.root, 'issuers', this.cacheKey(domain) + '.json'),
			512 * 1024
		);
		const url = issuerTomlUrl(domain);
		if (
			!isRecord(raw) ||
			typeof raw.homeDomain !== 'string' ||
			normalizeIssuerDomain(raw.homeDomain) !== domain ||
			raw.networkPassphrase !== this.network ||
			raw.tomlUrl !== url ||
			!Array.isArray(raw.currencies)
		)
			return empty;
		const fetchedAt = timestamp(raw.fetchedAt);
		const accountsIndexed = Array.isArray(raw.accounts);
		// A failed first fetch stores its attempt time in fetchedAt, without a document.
		if (raw.error !== null && fetchedAt === timestamp(raw.lastAttemptAt))
			return { ...empty, url };
		if (raw.error !== null || !isFreshDomainObservation(fetchedAt, now))
			return {
				...empty,
				status: fetchedAt ? 'stale' : 'unavailable',
				url,
				fetchedAt,
				accountsIndexed
			};

		const accounts = new Set(
			(Array.isArray(raw.accounts) ? raw.accounts : []).filter(
				(id): id is string =>
					typeof id === 'string' && StrKey.isValidEd25519PublicKey(id)
			)
		);
		const currencies = new Map<string, Set<string>>();
		for (const value of raw.currencies) {
			if (
				!isRecord(value) ||
				typeof value.issuer !== 'string' ||
				!StrKey.isValidEd25519PublicKey(value.issuer) ||
				typeof value.code !== 'string' ||
				!/^[a-zA-Z0-9]{1,12}$(?!\s)/.test(value.code) ||
				value.contract != null
			)
				continue;
			const codes = currencies.get(value.issuer) ?? new Set<string>();
			codes.add(value.code);
			currencies.set(value.issuer, codes);
		}
		return {
			status: 'available',
			url,
			fetchedAt,
			accountsIndexed,
			accounts,
			currencies
		};
	}

	private cacheKey(value: string): string {
		return createHash('sha256')
			.update(this.network + '\n' + value)
			.digest('hex');
	}
}

export function isFreshDomainObservation(
	observedAt: string | null,
	now: number
): boolean {
	if (!observedAt) return false;
	const age = now - Date.parse(observedAt);
	return age >= 0 && age < CACHE_FRESH_MS;
}

function timestamp(value: unknown): string | null {
	if (typeof value !== 'string' || value.length > 64) return null;
	const time = Date.parse(value);
	return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

async function readCacheJson(path: string, limit: number): Promise<unknown> {
	try {
		const file = await open(path, 'r');
		try {
			const stat = await file.stat();
			if (!stat.isFile() || stat.size > limit) return null;
			const buffer = Buffer.alloc(stat.size + 1);
			let offset = 0;
			while (offset < buffer.length) {
				const { bytesRead } = await file.read(
					buffer,
					offset,
					buffer.length - offset,
					offset
				);
				if (!bytesRead) break;
				offset += bytesRead;
			}
			return offset === stat.size
				? JSON.parse(buffer.toString('utf8', 0, offset))
				: null;
		} finally {
			await file.close();
		}
	} catch {
		return null;
	}
}
