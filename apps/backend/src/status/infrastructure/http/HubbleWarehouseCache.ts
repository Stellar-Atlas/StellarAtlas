import { queryHubbleAssetHolders } from './HubbleAssetHolderQuery.js';
import { HubbleWarehouseUnavailableError } from './HubbleWarehouseErrors.js';
import type { HubbleCatalog } from './HubbleWarehouseContracts.js';
import type {
	HubbleAssetHolderPage,
	HubbleAssetHolderQuery,
	HubbleSemanticQueryExecutor
} from './HubbleSemanticWarehouse.js';

interface Entry {
	expiresAt: number;
	pending: boolean;
	promise: Promise<HubbleAssetHolderPage>;
}

interface CatalogEntry {
	readonly expiresAt: number;
	readonly value: HubbleCatalog;
}

const catalogCacheMilliseconds = 15_000;
const holderPageCacheMilliseconds = 30_000;
const maximumHolderPageCacheEntries = 64;

export class HubbleWarehouseCache {
	private catalogValue: CatalogEntry | undefined;
	private catalogRequest: Promise<HubbleCatalog> | undefined;
	private readonly holderPages = new Map<string, Entry>();

	async catalog(
		force: boolean,
		load: () => Promise<HubbleCatalog>
	): Promise<HubbleCatalog> {
		const now = Date.now();
		if (!force && this.catalogValue && this.catalogValue.expiresAt > now)
			return this.catalogValue.value;
		if (!force && this.catalogRequest) return this.catalogRequest;
		const request = load();
		this.catalogRequest = request;
		try {
			const value = await request;
			this.catalogValue = {
				expiresAt: Date.now() + catalogCacheMilliseconds,
				value
			};
			return value;
		} finally {
			if (this.catalogRequest === request) this.catalogRequest = undefined;
		}
	}

	getAssetHolders(
		database: string,
		input: HubbleAssetHolderQuery,
		catalog: Pick<HubbleCatalog, 'coverage' | 'generatedAt'>,
		executor: HubbleSemanticQueryExecutor
	): Promise<HubbleAssetHolderPage> {
		const key = JSON.stringify({
			database,
			generatedAt: catalog.generatedAt,
			asset: input.asset,
			account: input.account ?? null,
			after: input.after ?? null,
			limit: input.limit ?? 100,
			sort: input.sort ?? 'account',
			order: input.order ?? 'asc',
			asOfLedger: input.asOfLedger ?? null,
			balanceFilter: input.balanceFilter ?? 'positive',
			includeDeleted: input.includeDeleted ?? false
		});
		const now = Date.now();
		for (const [cachedKey, entry] of this.holderPages) {
			if (!entry.pending && entry.expiresAt <= now)
				this.holderPages.delete(cachedKey);
		}
		const cached = this.holderPages.get(key);
		if (cached && (cached.pending || cached.expiresAt > now))
			return cached.promise;
		if (cached) this.holderPages.delete(key);
		while (this.holderPages.size >= maximumHolderPageCacheEntries) {
			const oldestSettled = [...this.holderPages].find(
				([, entry]) => !entry.pending
			)?.[0];
			if (oldestSettled === undefined)
				throw new HubbleWarehouseUnavailableError(
					'Holder query capacity is temporarily busy'
				);
			this.holderPages.delete(oldestSettled);
		}

		const entry: Entry = {
			expiresAt: now + holderPageCacheMilliseconds,
			pending: true,
			promise: queryHubbleAssetHolders(executor, input, catalog)
		};
		this.holderPages.set(key, entry);
		return entry.promise
			.catch((error) => {
				if (this.holderPages.get(key) === entry) this.holderPages.delete(key);
				throw error;
			})
			.finally(() => {
				entry.pending = false;
				if (this.holderPages.get(key) === entry)
					entry.expiresAt = Date.now() + holderPageCacheMilliseconds;
			});
	}
}
