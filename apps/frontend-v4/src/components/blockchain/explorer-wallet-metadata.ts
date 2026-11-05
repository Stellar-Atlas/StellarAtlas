'use client';

import { useEffect, useState } from 'react';
import { recordValue, requestExplorerJson, type EntityRecord } from '../../api/explorer-analytics';
import { classicAssetIdentity } from '../../api/explorer-current-account';
import { isContractAccount } from '../../domain/classic-account';

type Metadata = Readonly<Record<string, EntityRecord>>;
const empty: Metadata = {};
const batchLimit = 16, pageLimit = 25, cacheLimit = 256;
const logoPattern = /^\/v1\/asset-logos\/[a-f0-9]{64}\.(?:png|jpg|webp|gif)$/;

function parseHit(row: EntityRecord): EntityRecord | null {
	if (row.cacheStatus !== 'hit' || row.status !== 'ready') return null;
	const claim = recordValue(row.issuerCollectible);
	return {
		name: typeof row.name === 'string' ? row.name.trim().slice(0, 120) : null,
		logoUrl: row.logoStatus === 'ready' && typeof row.logoUrl === 'string' && logoPattern.test(row.logoUrl) ? row.logoUrl : null,
		fetchedAt: typeof row.fetchedAt === 'string' && Number.isFinite(Date.parse(row.fetchedAt)) ? row.fetchedAt : null,
		issuerCollectible: claim.source === 'issuer-toml' && claim.scarcity === 'unverified' &&
			(claim.kind === 'sep39-collectible-link' || claim.kind === 'sep1-nft-backed')
			? { source: claim.source, scarcity: claim.scarcity, kind: claim.kind } : null
	};
}

/** Bounded cache-only requests; concurrent views share exact-ID work. */
export class WalletAssetMetadataCache {
	private readonly cached = new Map<string, { value: EntityRecord | null; expires: number }>();
	private readonly pending = new Map<string, Promise<void>>();
	private batches = 0;

	constructor(private readonly request = requestExplorerJson) {}

	async load(ids: readonly string[]): Promise<Metadata> {
		const valid = [...new Set(ids)].slice(0, pageLimit).filter(id => classicAssetIdentity(id) !== null);
		for (const id of valid) if ((this.cached.get(id)?.expires ?? Infinity) <= Date.now()) this.cached.delete(id);
		const missing = valid.filter(id => !this.cached.has(id) && !this.pending.has(id));
		for (let offset = 0; offset < missing.length && this.batches < 2; offset += batchLimit) {
			const group = missing.slice(offset, offset + batchLimit);
			this.batches += 1;
			const work = this.batch(group).finally(() => {
				this.batches -= 1;
				for (const id of group) this.pending.delete(id);
			});
			for (const id of group) this.pending.set(id, work);
		}
		await Promise.all(new Set(valid.map(id => this.pending.get(id))));
		return Object.fromEntries(valid.flatMap(id => {
			const value = this.cached.get(id)?.value;
			return value ? [[id, value]] : [];
		}));
	}

	private async batch(group: readonly string[]): Promise<void> {
		const hits = new Map<string, EntityRecord>();
		try {
			const query = new URLSearchParams({ cacheOnly: 'true', assets: JSON.stringify(group) });
			const result = recordValue(await this.request('/v1/asset-metadata?' + query, AbortSignal.timeout(5_000)));
			if (Array.isArray(result.assets) && result.assets.length <= group.length) {
				for (const item of result.assets) {
					const row = recordValue(item), hit = parseHit(row);
					const identity = typeof row.id === 'string' && group.includes(row.id) ? classicAssetIdentity(row.id) : null;
					if (hit && identity && row.kind === 'classic' && row.code === identity.code && row.issuer === identity.issuer &&
						typeof row.contractId === 'string' && isContractAccount(row.contractId)) hits.set(identity.id, hit);
				}
			}
		} catch { /* Optional enrichment never warms the source or fails the wallet. */ }
		for (const id of group) {
			const value = hits.get(id) ?? null;
			this.cached.set(id, { value, expires: Date.now() + (value ? 300_000 : 30_000) });
		}
		while (this.cached.size > cacheLimit) this.cached.delete(this.cached.keys().next().value!);
	}
}

const walletMetadata = new WalletAssetMetadataCache();

export function useWalletAssetMetadata(ids: readonly string[]): Metadata {
	const key = JSON.stringify([...new Set(ids)].slice(0, pageLimit).sort());
	const [loaded, setLoaded] = useState<{ key: string; value: Metadata } | null>(null);
	useEffect(() => {
		let disposed = false;
		void walletMetadata.load(JSON.parse(key) as string[]).then(value => {
			if (!disposed) setLoaded({ key, value });
		});
		return () => { disposed = true; };
	}, [key]);
	return loaded?.key === key ? loaded.value : empty;
}
