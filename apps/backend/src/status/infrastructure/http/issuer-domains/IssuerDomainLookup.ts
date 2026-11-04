import { StrKey } from '@stellar/stellar-sdk';
import type { AssetCatalogue } from '../asset-catalogue/AssetCatalogue.js';
import type { AssetObservation } from '../asset-catalogue/AssetCatalogueSource.js';
import {
	isFreshDomainObservation,
	type IssuerDomainCache
} from './IssuerDomainCache.js';

const MAX_ACCOUNTS = 25;
const MAX_ASSETS_PER_ACCOUNT = 20;
const MAX_CATALOGUE_ASSETS = 100_000;
const MAX_ACTIVE_LOOKUPS = 8;
const SNAPSHOT_TTL_MS = 60_000;

export class IssuerDomainBusy extends Error {}

export class IssuerDomainLookup {
	private indexed: ReturnType<IssuerDomainLookup['index']> | undefined;
	private refreshAt = 0;
	private active = 0;

	constructor(
		private readonly cache: Pick<
			IssuerDomainCache,
			'readIndexedDomains' | 'readToml'
		>,
		private readonly catalogue: Pick<
			AssetCatalogue,
			'issuerObservationsSnapshot'
		>,
		private readonly now: () => number = Date.now
	) {}

	async lookup(domain: string) {
		if (this.active >= MAX_ACTIVE_LOOKUPS) throw new IssuerDomainBusy();
		this.active++;
		try {
			const now = this.now();
			const [snapshot, toml] = await Promise.all([
				this.getIndex(),
				this.cache.readToml(domain, now)
			]);
			const indexedIds = snapshot.domains.byDomain.get(domain) ?? [];
			const claimedIds = new Set([...toml.accounts, ...toml.currencies.keys()]);
			for (const id of indexedIds) claimedIds.delete(id);
			const ids = [...[...indexedIds].sort(), ...[...claimedIds].sort()];
			const accounts = ids.slice(0, MAX_ACCOUNTS).map((id) => {
				const indexed = snapshot.domains.byAccount.get(id);
				const fresh =
					indexed !== undefined &&
					!indexed.lastAttemptFailed &&
					isFreshDomainObservation(indexed.observedAt, now);
				const listedCodes = toml.currencies.get(id);
				const listedAccount = toml.accounts.has(id);
				const claimed = listedAccount || listedCodes !== undefined;
				const matchingDomain = indexed?.homeDomain === domain;
				const association =
					indexed && !fresh
						? 'unavailable'
						: matchingDomain
							? claimed
								? 'corroborated'
								: 'indexed_only'
							: indexed?.homeDomain && claimed
								? 'mismatch'
								: 'toml_only';
				const indexedAssets = snapshot.assets.get(id);
				const codes = new Set<string>();
				if (matchingDomain && indexedAssets) {
					for (const code of indexedAssets.keys()) {
						if (codes.size > MAX_ASSETS_PER_ACCOUNT) break;
						codes.add(code);
					}
				}
				for (const code of listedCodes ?? []) {
					if (codes.size > MAX_ASSETS_PER_ACCOUNT) break;
					codes.add(code);
				}
				const assets = [...codes]
					.slice(0, MAX_ASSETS_PER_ACCOUNT)
					.sort()
					.map((code) => {
						const observation = indexedAssets?.get(code);
						const assetRef = code + ':' + id;
						return {
							id: assetRef,
							code,
							catalogue: observation
								? { lastObservedLedger: observation.lastObservedLedger }
								: null,
							toml: listedCodes?.has(code)
								? 'listed'
								: toml.status === 'available'
									? 'not_listed'
									: 'unavailable',
							explorer: '/explorer/assets/' + encodeURIComponent(assetRef)
						};
					});
				return {
					accountId: id,
					association,
					homeDomain: indexed
						? {
								source: 'indexed_account_home_domain',
								domain: indexed.homeDomain,
								observedAt: indexed.observedAt,
								status: fresh
									? 'observed'
									: indexed.observedAt
										? 'stale'
										: 'unavailable'
							}
						: null,
					tomlClaims: [
						...(listedAccount ? ['ACCOUNTS'] : []),
						...(listedCodes ? ['CURRENCIES'] : [])
					],
					assets,
					assetsTruncated: codes.size > MAX_ASSETS_PER_ACCOUNT,
					links: {
						account: '/explorer/accounts/' + id,
						issuerAssets: '/v1/issuers/' + id + '/assets'
					}
				};
			});
			return {
				domain,
				source: 'cached_issuer_domain_evidence',
				homeDomainIndex: snapshot.domains.status,
				catalogue: {
					generatedAt: snapshot.generatedAt,
					status: snapshot.assetStatus
				},
				toml: {
					status: toml.status,
					url: toml.url,
					fetchedAt: toml.fetchedAt,
					accountsIndexed: toml.accountsIndexed
				},
				accounts,
				accountsTruncated: ids.length > MAX_ACCOUNTS
			};
		} finally {
			this.active--;
		}
	}

	private getIndex() {
		if (!this.indexed || this.now() >= this.refreshAt) {
			this.refreshAt = Infinity;
			this.indexed = this.index().finally(() => {
				this.refreshAt = this.now() + SNAPSHOT_TTL_MS;
			});
		}
		return this.indexed;
	}

	private async index() {
		const [domains, catalogue] = await Promise.all([
			this.cache.readIndexedDomains(),
			this.catalogue.issuerObservationsSnapshot().catch(() => null)
		]);
		const assets = new Map<string, Map<string, AssetObservation>>();
		if (catalogue?.generatedAt) {
			for (
				let i = 0;
				i < Math.min(catalogue.assets.length, MAX_CATALOGUE_ASSETS);
				i++
			) {
				const item = catalogue.assets[i]!;
				if (
					item.kind !== 'classic' ||
					!item.code ||
					!item.issuer ||
					!/^[a-zA-Z0-9]{1,12}$/.test(item.code) ||
					!StrKey.isValidEd25519PublicKey(item.issuer) ||
					item.id !== item.code + ':' + item.issuer ||
					!Number.isSafeInteger(item.lastObservedLedger) ||
					item.lastObservedLedger < 1
				)
					continue;
				const byCode =
					assets.get(item.issuer) ?? new Map<string, AssetObservation>();
				byCode.set(item.code, item);
				assets.set(item.issuer, byCode);
			}
		}
		return {
			domains,
			assets,
			generatedAt: catalogue?.generatedAt ?? null,
			assetStatus: !catalogue?.generatedAt
				? 'unavailable'
				: catalogue.assets.length > MAX_CATALOGUE_ASSETS
					? 'partial'
					: 'available'
		};
	}
}
