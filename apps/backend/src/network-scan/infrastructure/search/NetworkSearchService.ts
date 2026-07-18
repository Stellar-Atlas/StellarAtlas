import { Meilisearch, type Index } from 'meilisearch';
import { networkSearchIndexSchemaVersion } from '@core/config/SearchConfigDefaults.js';
import type { Logger } from '@core/services/Logger.js';
import {
	assertMeilisearchTaskSucceeded,
	ensureMeilisearchSettings
} from './MeilisearchIndexSettings.js';
import { buildNetworkSearchSnapshot } from './NetworkSearchDocumentBuilder.js';
import {
	memorySearch,
	networkSearchRequiredSettings,
	sanitizeSearchLimit
} from './NetworkSearchQuery.js';
import {
	networkSearchGenerationMatches,
	queryNetworkSearchIndex
} from './NetworkSearchIndexedQuery.js';
import {
	PostgresNetworkSearchCanonicalArchiveSource,
	type NetworkSearchCanonicalArchiveSource
} from './NetworkSearchCanonicalArchiveSource.js';
import type {
	NetworkSearchConfig,
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
const projectionRequestTimeoutMs = 60_000;
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
	state.canonicalArchiveRevision === snapshot.canonicalArchiveRevision &&
	state.canonicalCursor === snapshot.canonicalCursor &&
	state.networkTime === snapshot.networkTime;

const isIndexStateDocument = (
	state: NetworkSearchIndexStateDocument
): boolean =>
	state.documentKind === 'state' &&
	state.id === networkSearchStateDocumentId &&
	typeof state.canonicalArchiveRevision === 'string' &&
	state.canonicalArchiveRevision.length > 0 &&
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
	private readonly canonicalArchiveSource: NetworkSearchCanonicalArchiveSource;
	private readonly projectionIndex:
		Index<NetworkSearchStoredDocument> | undefined;
	private readonly writable: boolean;
	private nextSyncAttemptAtMs = 0;
	private syncPromise: Promise<void> | undefined;

	constructor(
		config: NetworkSearchConfig,
		private logger?: Logger,
		indexOverride?: Index<NetworkSearchStoredDocument>,
		projectionIndexOverride?: Index<NetworkSearchStoredDocument>,
		canonicalArchiveSourceOverride?: NetworkSearchCanonicalArchiveSource
	) {
		this.indexName = config.indexName;
		this.writable = config.writable !== false;
		this.canonicalArchiveSource =
			canonicalArchiveSourceOverride ??
			new PostgresNetworkSearchCanonicalArchiveSource();
		if (indexOverride) {
			this.index = indexOverride;
			this.projectionIndex = this.writable
				? (projectionIndexOverride ?? indexOverride)
				: undefined;
		} else if (config.host && config.host.length > 0) {
			const readClient = new Meilisearch({
				apiKey: config.apiKey,
				host: config.host,
				timeout: searchRequestTimeoutMs
			});
			this.index = readClient.index<NetworkSearchStoredDocument>(
				config.indexName
			);
			if (this.writable) {
				const projectionClient = new Meilisearch({
					apiKey: config.apiKey,
					host: config.host,
					timeout: projectionRequestTimeoutMs
				});
				this.projectionIndex =
					projectionClient.index<NetworkSearchStoredDocument>(config.indexName);
			}
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
					void this.startSyncIndex();
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
				void this.startSyncIndex();
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
				void this.startSyncIndex();
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

			const indexed = await this.queryStableGeneration(state, request);
			if (indexed !== null) return indexed;
			this.indexReady = false;
			void this.startSyncIndex();
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
			if (!isIndexStateDocument(state)) return null;
			let candidate = state;
			for (let attempt = 0; attempt < 2; attempt += 1) {
				if (
					!(await this.matchesCanonicalState(
						candidate,
						request,
						canonicalNetworkTime
					))
				) {
					return null;
				}
				const response = await queryNetworkSearchIndex(
					this.index,
					candidate,
					request,
					this.indexedReadModel(candidate)
				);
				const confirmed = await this.readIndexState();
				if (
					networkSearchGenerationMatches(candidate, confirmed) &&
					(await this.matchesCanonicalState(
						confirmed,
						request,
						canonicalNetworkTime
					))
				) {
					this.indexReady = true;
					return response;
				}
				candidate = confirmed;
			}
			return null;
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

	async refreshProjection(inventory: NetworkSearchInventory): Promise<void> {
		const targetCursor = this.refreshSnapshot(inventory).canonicalCursor;
		await this.startSyncIndex();
		if (
			this.snapshot?.canonicalCursor === targetCursor &&
			!this.indexReady &&
			Date.now() >= this.nextSyncAttemptAtMs
		) {
			await this.startSyncIndex();
		}
	}

	private async queryStableGeneration(
		state: NetworkSearchIndexStateDocument,
		request: NetworkSearchRequest
	): Promise<NetworkSearchResponse | null> {
		if (!this.index) throw new Error('Network search index is not configured');
		const response = await queryNetworkSearchIndex(
			this.index,
			state,
			request,
			this.indexedReadModel(state)
		);
		const confirmed = await this.readIndexState();
		return networkSearchGenerationMatches(state, confirmed) ? response : null;
	}

	private async matchesCanonicalState(
		state: NetworkSearchIndexStateDocument,
		request: NetworkSearchRequest,
		canonicalNetworkTime: Date
	): Promise<boolean> {
		if (Date.parse(state.networkTime) !== canonicalNetworkTime.getTime()) {
			return false;
		}
		if (
			request.canonicalCursor !== undefined &&
			request.canonicalCursor !== state.canonicalCursor
		) {
			return false;
		}
		const canonicalArchives = await this.canonicalArchiveSource.load();
		return canonicalArchives.revision === state.canonicalArchiveRevision;
	}

	private indexedReadModel(
		state: NetworkSearchIndexStateDocument
	): NetworkSearchReadModel {
		return {
			canonicalCursor: state.canonicalCursor,
			fallbackReason: null,
			freshness: 'fresh',
			observedAt: state.indexedAt,
			schemaVersion: networkSearchIndexSchemaVersion,
			source: 'meilisearch'
		};
	}

	private async readIndexState(): Promise<NetworkSearchIndexStateDocument> {
		if (!this.index) throw new Error('Network search index is not configured');
		const state = await this.index.getDocument<NetworkSearchIndexStateDocument>(
			networkSearchStateDocumentId
		);
		if (!isIndexStateDocument(state)) {
			throw new Error('Network search index state is invalid');
		}
		return state;
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
		return snapshot;
	}

	private markIndexUnavailable(
		error: unknown,
		snapshot: NetworkSearchSnapshot,
		request: NetworkSearchRequest
	): void {
		this.indexReady = false;
		this.syncFailed = true;
		void this.startSyncIndex();
		this.logger?.error('Network search Meilisearch unavailable', {
			error: errorMessage(error),
			indexName: this.indexName,
			limit: sanitizeSearchLimit(request.limit),
			networkTime: snapshot.networkTime,
			queryLength: request.query.length
		});
	}

	private syncIndex(): Promise<void> {
		if (!this.projectionIndex || this.indexReady || !this.snapshot) {
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

	private startSyncIndex(): Promise<void> {
		return this.writable ? this.syncIndex() : Promise.resolve();
	}

	private async writeIndex(snapshot: NetworkSearchSnapshot): Promise<void> {
		if (!this.projectionIndex) return;
		if (!this.settingsReady) await this.syncSettings();
		const projectionIndex = this.projectionIndex;

		const state: NetworkSearchIndexStateDocument = {
			canonicalArchiveRevision: snapshot.canonicalArchiveRevision,
			canonicalCursor: snapshot.canonicalCursor,
			documentKind: 'state',
			id: networkSearchStateDocumentId,
			indexedAt: new Date().toISOString(),
			networkTime: snapshot.networkTime
		};
		const documentTask = await projectionIndex
			.addDocuments([state, ...snapshot.documents], { primaryKey: 'id' })
			.waitTask({
				interval: taskPollIntervalMs,
				timeout: documentTaskTimeoutMs
			});
		assertMeilisearchTaskSucceeded(documentTask.status, 'document update');
		if (this.snapshot?.canonicalCursor !== snapshot.canonicalCursor) return;

		const cleanupTask = await projectionIndex
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
		if (!this.projectionIndex || this.settingsReady) return;
		await ensureMeilisearchSettings(
			this.projectionIndex,
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
