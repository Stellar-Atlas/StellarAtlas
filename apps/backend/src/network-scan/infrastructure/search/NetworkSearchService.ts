import { Meilisearch, type Index } from 'meilisearch';
import { networkSearchIndexSchemaVersion } from '@core/config/SearchConfigDefaults.js';
import type { Logger } from '@core/services/Logger.js';
import {
	assertMeilisearchTaskSucceeded,
	ensureMeilisearchSettings
} from './MeilisearchIndexSettings.js';
import { buildNetworkSearchSnapshot } from './NetworkSearchDocumentBuilder.js';
import {
	buildFacetsFromDistribution,
	buildMeilisearchFilter,
	memorySearch,
	networkSearchFacetAttributes,
	networkSearchHitAttributes,
	networkSearchRequiredSettings,
	sanitizeSearchLimit,
	sanitizeSearchOffset,
	toSearchHit
} from './NetworkSearchQuery.js';
import type {
	NetworkSearchConfig,
	NetworkSearchDocument,
	NetworkSearchFallbackReason,
	NetworkSearchIndexStateDocument,
	NetworkSearchInventory,
	NetworkSearchReadModel,
	NetworkSearchRequest,
	NetworkSearchResponse,
	NetworkSearchSnapshot,
	NetworkSearchStoredDocument
} from './NetworkSearchTypes.js';

export const networkSearchStateDocumentId = 'network_search_state';

const taskPollIntervalMs = 50;
const settingsTaskTimeoutMs = 60_000;
const documentTaskTimeoutMs = 60_000;
const searchRequestTimeoutMs = 500;
const syncRetryCooldownMs = 60_000;

const errorMessage = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

const readModel = (
	snapshot: NetworkSearchSnapshot,
	source: NetworkSearchReadModel['source'],
	fallbackReason: NetworkSearchFallbackReason | null,
	observedAt: string
): NetworkSearchReadModel => ({
	canonicalCursor: snapshot.canonicalCursor,
	fallbackReason,
	freshness: 'fresh',
	observedAt,
	schemaVersion: networkSearchIndexSchemaVersion,
	source
});

const stateMatchesSnapshot = (
	state: NetworkSearchIndexStateDocument,
	snapshot: NetworkSearchSnapshot
): boolean =>
	state.documentKind === 'state' &&
	state.id === networkSearchStateDocumentId &&
	state.canonicalCursor === snapshot.canonicalCursor &&
	state.networkTime === snapshot.networkTime;

const isIndexStateDocument = (
	state: NetworkSearchIndexStateDocument
): boolean =>
	state.documentKind === 'state' &&
	state.id === networkSearchStateDocumentId &&
	typeof state.canonicalCursor === 'string' &&
	state.canonicalCursor.length > 0 &&
	typeof state.indexedAt === 'string' &&
	Number.isFinite(Date.parse(state.indexedAt)) &&
	typeof state.networkTime === 'string' &&
	Number.isFinite(Date.parse(state.networkTime));

export class NetworkSearchService {
	private snapshot: NetworkSearchSnapshot | undefined;
	private inventoryGeneratedAt: string | undefined;
	private indexReady = false;
	private settingsReady = false;
	private syncFailed = false;
	private readonly index: Index<NetworkSearchStoredDocument> | undefined;
	private readonly indexName: string;
	private nextSyncAttemptAtMs = 0;
	private syncPromise: Promise<void> | undefined;

	constructor(
		config: NetworkSearchConfig,
		private logger?: Logger,
		indexOverride?: Index<NetworkSearchStoredDocument>
	) {
		this.indexName = config.indexName;
		if (indexOverride) {
			this.index = indexOverride;
		} else if (config.host && config.host.length > 0) {
			const client = new Meilisearch({
				apiKey: config.apiKey,
				host: config.host,
				timeout: searchRequestTimeoutMs
			});
			this.index = client.index<NetworkSearchStoredDocument>(config.indexName);
		}
	}

	async search(
		inventory: NetworkSearchInventory,
		request: NetworkSearchRequest
	): Promise<NetworkSearchResponse> {
		const snapshot = this.refreshSnapshot(inventory);

		if (!this.index) {
			return memorySearch(
				snapshot,
				request,
				readModel(
					snapshot,
					'postgres_canonical',
					'meilisearch_unconfigured',
					inventory.generatedAt
				)
			);
		}

		let validatedState: NetworkSearchIndexStateDocument | undefined;
		if (!this.indexReady) {
			try {
				const existingState =
					await this.index.getDocument<NetworkSearchIndexStateDocument>(
						networkSearchStateDocumentId
					);
				if (stateMatchesSnapshot(existingState, snapshot)) {
					this.indexReady = true;
					validatedState = existingState;
				} else {
					this.startSyncIndex();
					return memorySearch(
						snapshot,
						request,
						readModel(
							snapshot,
							'postgres_canonical',
							'meilisearch_stale',
							inventory.generatedAt
						)
					);
				}
			} catch {
				this.startSyncIndex();
				return memorySearch(
					snapshot,
					request,
					readModel(
						snapshot,
						'postgres_canonical',
						this.syncFailed ? 'meilisearch_unavailable' : 'meilisearch_syncing',
						inventory.generatedAt
					)
				);
			}
		}

		try {
			const state =
				validatedState ??
				(await this.index.getDocument<NetworkSearchIndexStateDocument>(
					networkSearchStateDocumentId
				));
			if (!stateMatchesSnapshot(state, snapshot)) {
				this.indexReady = false;
				this.startSyncIndex();
				return memorySearch(
					snapshot,
					request,
					readModel(
						snapshot,
						'postgres_canonical',
						'meilisearch_stale',
						inventory.generatedAt
					)
				);
			}

			return await this.queryIndex(state, request);
		} catch (error) {
			this.markIndexUnavailable(error, snapshot, request);
			return memorySearch(
				snapshot,
				request,
				readModel(
					snapshot,
					'postgres_canonical',
					'meilisearch_unavailable',
					inventory.generatedAt
				)
			);
		}
	}

	async searchIndexed(
		request: NetworkSearchRequest,
		canonicalNetworkTime: Date | undefined
	): Promise<NetworkSearchResponse | null> {
		if (!this.index || canonicalNetworkTime === undefined) return null;

		try {
			const state =
				await this.index.getDocument<NetworkSearchIndexStateDocument>(
					networkSearchStateDocumentId
				);
			if (
				!isIndexStateDocument(state) ||
				state.networkTime !== canonicalNetworkTime.toISOString()
			)
				return null;
			this.indexReady = true;
			return await this.queryIndex(state, request);
		} catch (error) {
			this.indexReady = false;
			this.syncFailed = true;
			this.logger?.warn('Network search projection read unavailable', {
				error: errorMessage(error),
				indexName: this.indexName,
				limit: sanitizeSearchLimit(request.limit),
				queryLength: request.query.length
			});
			return null;
		}
	}

	refreshProjection(inventory: NetworkSearchInventory): void {
		this.refreshSnapshot(inventory);
		this.startSyncIndex();
	}

	private async queryIndex(
		state: NetworkSearchIndexStateDocument,
		request: NetworkSearchRequest
	): Promise<NetworkSearchResponse> {
		if (!this.index) throw new Error('Network search index is not configured');
		const limit = sanitizeSearchLimit(request.limit);
		const offset = sanitizeSearchOffset(request.offset);
		const response = await this.index.search<NetworkSearchDocument>(
			request.query,
			{
				attributesToRetrieve: [...networkSearchHitAttributes],
				facets: [...networkSearchFacetAttributes],
				filter: buildMeilisearchFilter(request, state.canonicalCursor),
				limit,
				offset
			}
		);
		const total = response.estimatedTotalHits ?? response.hits.length;
		const snapshot = {
			canonicalCursor: state.canonicalCursor,
			documents: [],
			generatedAt: state.indexedAt,
			networkTime: state.networkTime
		} satisfies NetworkSearchSnapshot;

		return {
			estimatedTotalHits: total,
			facets: buildFacetsFromDistribution(response.facetDistribution),
			hits: response.hits.map((hit) => toSearchHit(hit, 'meilisearch')),
			indexedNetworkTime: state.networkTime,
			pagination: {
				hasMore: offset + response.hits.length < total,
				limit,
				offset,
				total,
				totalIsExact: false
			},
			query: request.query,
			readModel: readModel(snapshot, 'meilisearch', null, state.indexedAt),
			scope: request.scope,
			source: 'meilisearch'
		};
	}

	private refreshSnapshot(
		inventory: NetworkSearchInventory
	): NetworkSearchSnapshot {
		if (this.snapshot && this.inventoryGeneratedAt === inventory.generatedAt) {
			return this.snapshot;
		}
		const snapshot = buildNetworkSearchSnapshot(inventory);
		this.inventoryGeneratedAt = inventory.generatedAt;
		if (this.snapshot?.canonicalCursor === snapshot.canonicalCursor) {
			return this.snapshot;
		}

		this.snapshot = snapshot;
		this.indexReady = false;
		if (Date.now() >= this.nextSyncAttemptAtMs) this.syncFailed = false;
		this.syncPromise = undefined;
		return snapshot;
	}

	private markIndexUnavailable(
		error: unknown,
		snapshot: NetworkSearchSnapshot,
		request: NetworkSearchRequest
	): void {
		this.indexReady = false;
		this.syncFailed = true;
		this.startSyncIndex();
		this.logger?.error('Network search Meilisearch unavailable', {
			error: errorMessage(error),
			indexName: this.indexName,
			limit: sanitizeSearchLimit(request.limit),
			networkTime: snapshot.networkTime,
			queryLength: request.query.length
		});
	}

	private syncIndex(): Promise<void> {
		if (!this.index || this.indexReady || !this.snapshot) {
			return Promise.resolve();
		}
		if (this.syncPromise) return this.syncPromise;
		if (Date.now() < this.nextSyncAttemptAtMs) return Promise.resolve();

		const snapshot = this.snapshot;
		const syncPromise = this.writeIndex(snapshot)
			.then(() => {
				if (this.snapshot?.canonicalCursor !== snapshot.canonicalCursor) return;
				this.indexReady = true;
				this.syncFailed = false;
				this.nextSyncAttemptAtMs = 0;
				this.logger?.info('Network search Meilisearch index synced', {
					canonicalCursor: snapshot.canonicalCursor,
					documentCount: snapshot.documents.length,
					indexName: this.indexName,
					networkTime: snapshot.networkTime
				});
			})
			.catch((error: unknown) => {
				this.syncFailed = true;
				this.nextSyncAttemptAtMs = Date.now() + syncRetryCooldownMs;
				this.logger?.error('Network search Meilisearch sync failed', {
					error: errorMessage(error),
					indexName: this.indexName,
					networkTime: snapshot.networkTime
				});
			})
			.finally(() => {
				if (this.syncPromise === syncPromise) this.syncPromise = undefined;
			});
		this.syncPromise = syncPromise;
		return syncPromise;
	}

	private startSyncIndex(): void {
		void this.syncIndex();
	}

	private async writeIndex(snapshot: NetworkSearchSnapshot): Promise<void> {
		if (!this.index) return;
		if (!this.settingsReady) await this.syncSettings();

		const state: NetworkSearchIndexStateDocument = {
			canonicalCursor: snapshot.canonicalCursor,
			documentKind: 'state',
			id: networkSearchStateDocumentId,
			indexedAt: new Date().toISOString(),
			networkTime: snapshot.networkTime
		};
		const documentTask = await this.index
			.addDocuments([state, ...snapshot.documents], { primaryKey: 'id' })
			.waitTask({
				interval: taskPollIntervalMs,
				timeout: documentTaskTimeoutMs
			});
		assertMeilisearchTaskSucceeded(documentTask.status, 'document update');
		if (this.snapshot?.canonicalCursor !== snapshot.canonicalCursor) return;

		const cleanupTask = await this.index
			.deleteDocuments({
				filter: `documentKind = "entity" AND canonicalCursor != ${JSON.stringify(snapshot.canonicalCursor)}`
			})
			.waitTask({
				interval: taskPollIntervalMs,
				timeout: documentTaskTimeoutMs
			});
		assertMeilisearchTaskSucceeded(
			cleanupTask.status,
			'stale document cleanup'
		);
	}

	private async syncSettings(): Promise<void> {
		if (!this.index || this.settingsReady) return;
		await ensureMeilisearchSettings(
			this.index,
			networkSearchRequiredSettings,
			{
				interval: taskPollIntervalMs,
				timeout: settingsTaskTimeoutMs
			},
			'settings'
		);
		this.settingsReady = true;
	}
}
