import { Meilisearch, type Index } from 'meilisearch';
import { networkSearchIndexSchemaVersion } from '@core/config/SearchConfigDefaults.js';
import type { Logger } from '@core/services/Logger.js';
import type { NetworkV1 } from 'shared';
import { buildNetworkSearchDocuments } from './NetworkSearchDocumentBuilder.js';
import type {
	NetworkSearchConfig,
	NetworkSearchDocument,
	NetworkSearchFacetName,
	NetworkSearchFacets,
	NetworkSearchFacetValue,
	NetworkSearchFallbackReason,
	NetworkSearchHit,
	NetworkSearchReadModel,
	NetworkSearchRequest,
	NetworkSearchResponse
} from './NetworkSearchTypes.js';

const SEARCHABLE_ATTRIBUTES = [
	'label',
	'detail',
	'content',
	'publicKey',
	'homeDomain',
	'organizationName',
	'version',
	'countryName',
	'countryCode',
	'isp'
] as const;

const FILTERABLE_ATTRIBUTES = [
	'entityType',
	'organizationId',
	'organizationName',
	'validating',
	'validator',
	'fullValidator',
	'topTier',
	'active',
	'archiveStatus',
	'countryCode',
	'countryName',
	'isp',
	'latestLedger',
	'networkTime'
] as const;

const FACET_ATTRIBUTES: readonly NetworkSearchFacetName[] = [
	'entityType',
	'archiveStatus',
	'countryCode',
	'validator',
	'validating',
	'fullValidator',
	'active',
	'topTier'
];

const HIT_ATTRIBUTES = [
	'detail',
	'entityId',
	'entityType',
	'href',
	'id',
	'label',
	'organizationName'
] as const;

const SORTABLE_ATTRIBUTES = ['label', 'networkTime', 'latestLedger'] as const;
const taskPollIntervalMs = 50;
const settingsTaskTimeoutMs = 60_000;
const documentTaskTimeoutMs = 60_000;

const sanitizeLimit = (limit: number): number => {
	if (!Number.isInteger(limit)) return 8;
	return Math.min(Math.max(limit, 1), 25);
};

const normalize = (value: string): string => value.trim().toLowerCase();

const toHit = (document: NetworkSearchDocument): NetworkSearchHit => ({
	detail: document.detail,
	entityId: document.entityId,
	entityType: document.entityType,
	href: document.href,
	id: document.id,
	label: document.label,
	organizationName: document.organizationName
});

const matchesDocument = (
	document: NetworkSearchDocument,
	request: NetworkSearchRequest
): boolean => {
	if (request.entityType && document.entityType !== request.entityType)
		return false;
	if (
		request.archiveStatus &&
		document.archiveStatus !== request.archiveStatus
	) {
		return false;
	}
	if (request.countryCode && document.countryCode !== request.countryCode)
		return false;
	if (
		request.organizationId &&
		document.organizationId !== request.organizationId
	) {
		return false;
	}
	if (request.active !== undefined && document.active !== request.active)
		return false;
	if (
		request.fullValidator !== undefined &&
		document.fullValidator !== request.fullValidator
	) {
		return false;
	}
	if (
		request.validator !== undefined &&
		document.validator !== request.validator
	)
		return false;
	if (
		request.validating !== undefined &&
		document.validating !== request.validating
	) {
		return false;
	}
	if (request.topTier !== undefined && document.topTier !== request.topTier)
		return false;

	const query = normalize(request.query);
	if (query.length === 0) return true;

	return normalize(document.content).includes(query);
};

const emptyFacets = (): NetworkSearchFacets => ({
	active: [],
	archiveStatus: [],
	countryCode: [],
	entityType: [],
	fullValidator: [],
	topTier: [],
	validating: [],
	validator: []
});

const facetValue = (
	document: NetworkSearchDocument,
	facet: NetworkSearchFacetName
): string | undefined => {
	const value = document[facet];
	if (value === undefined) return undefined;
	return String(value);
};

const sortFacetValues = (
	values: NetworkSearchFacetValue[]
): NetworkSearchFacetValue[] =>
	values.toSorted(
		(left, right) =>
			right.count - left.count || left.value.localeCompare(right.value)
	);

const buildFacetsFromDocuments = (
	documents: readonly NetworkSearchDocument[]
): NetworkSearchFacets => {
	const facets = emptyFacets();

	for (const facet of FACET_ATTRIBUTES) {
		const counts = new Map<string, number>();
		for (const document of documents) {
			const value = facetValue(document, facet);
			if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
		}
		facets[facet] = sortFacetValues(
			Array.from(counts, ([value, count]) => ({ count, value }))
		);
	}

	return facets;
};

const memorySearch = (
	documents: readonly NetworkSearchDocument[],
	request: NetworkSearchRequest,
	networkTime: string,
	readModel: NetworkSearchReadModel
): NetworkSearchResponse => {
	const matching = documents.filter((document) =>
		matchesDocument(document, request)
	);

	return {
		estimatedTotalHits: matching.length,
		facets: buildFacetsFromDocuments(matching),
		hits: matching.slice(0, sanitizeLimit(request.limit)).map(toHit),
		indexedNetworkTime: networkTime,
		query: request.query,
		readModel,
		source: 'memory'
	};
};

const quoteFilterValue = (value: string): string => JSON.stringify(value);

const filterCondition = (
	field: string,
	value: string | boolean | undefined
): string | undefined => {
	if (value === undefined) return undefined;
	return typeof value === 'boolean'
		? `${field} = ${value}`
		: `${field} = ${quoteFilterValue(value)}`;
};

const buildMeilisearchFilter = (
	request: NetworkSearchRequest,
	networkTime: string
): string | undefined => {
	const filters = [
		filterCondition('networkTime', networkTime),
		filterCondition('entityType', request.entityType),
		filterCondition('archiveStatus', request.archiveStatus),
		filterCondition('countryCode', request.countryCode),
		filterCondition('organizationId', request.organizationId),
		filterCondition('active', request.active),
		filterCondition('fullValidator', request.fullValidator),
		filterCondition('validator', request.validator),
		filterCondition('validating', request.validating),
		filterCondition('topTier', request.topTier)
	].filter((filter): filter is string => filter !== undefined);

	return filters.join(' AND ');
};

const facetDistributionValue = (
	distribution: Record<string, Record<string, number>> | undefined,
	facet: NetworkSearchFacetName
): readonly NetworkSearchFacetValue[] => {
	const values = distribution?.[facet];
	if (!values) return [];
	return sortFacetValues(
		Object.entries(values).map(([value, count]) => ({ count, value }))
	);
};

const buildFacetsFromDistribution = (
	distribution: Record<string, Record<string, number>> | undefined
): NetworkSearchFacets => {
	const facets = emptyFacets();
	for (const facet of FACET_ATTRIBUTES) {
		facets[facet] = facetDistributionValue(distribution, facet);
	}
	return facets;
};

const assertTaskSucceeded = (status: string, taskName: string): void => {
	if (status !== 'succeeded')
		throw new Error(`Meilisearch ${taskName} task ended with ${status}`);
};

const errorMessage = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

const readModel = (
	fallbackReason: NetworkSearchFallbackReason | null
): NetworkSearchReadModel => ({
	fallbackReason,
	schemaVersion: networkSearchIndexSchemaVersion
});

export class NetworkSearchService {
	private documents: readonly NetworkSearchDocument[] = [];
	private indexedNetworkTime: string | undefined;
	private indexReady = false;
	private settingsReady = false;
	private syncFailed = false;
	private readonly index: Index<NetworkSearchDocument> | undefined;
	private readonly indexName: string;
	private syncPromise: Promise<void> | undefined;

	constructor(config: NetworkSearchConfig, private logger?: Logger) {
		this.indexName = config.indexName;
		if (config.host && config.host.length > 0) {
			const client = new Meilisearch({
				apiKey: config.apiKey,
				host: config.host
			});
			this.index = client.index<NetworkSearchDocument>(config.indexName);
		}
	}

	async search(
		network: NetworkV1,
		request: NetworkSearchRequest
	): Promise<NetworkSearchResponse> {
		this.refreshDocuments(network);

		if (!this.index) {
			return memorySearch(
				this.documents,
				request,
				network.time,
				readModel('meilisearch_unconfigured')
			);
		}

		if (!this.indexReady) {
			this.startSyncIndex();
			return memorySearch(
				this.documents,
				request,
				network.time,
				readModel(
					this.syncFailed ? 'meilisearch_unavailable' : 'meilisearch_syncing'
				)
			);
		}

		try {
			const filter = buildMeilisearchFilter(request, network.time);
			const response = await this.index.search<NetworkSearchDocument>(
				request.query,
				{
					attributesToRetrieve: [...HIT_ATTRIBUTES],
					facets: [...FACET_ATTRIBUTES],
					filter,
					limit: sanitizeLimit(request.limit)
				}
			);

			return {
				estimatedTotalHits: response.estimatedTotalHits ?? response.hits.length,
				facets: buildFacetsFromDistribution(response.facetDistribution),
				hits: response.hits.map(toHit),
				indexedNetworkTime: network.time,
				query: request.query,
				readModel: readModel(null),
				source: 'meilisearch'
			};
		} catch (error) {
			this.indexReady = false;
			this.syncFailed = true;
			this.startSyncIndex();
			this.logger?.error('Network search Meilisearch unavailable', {
				error: errorMessage(error),
				indexName: this.indexName,
				limit: sanitizeLimit(request.limit),
				networkTime: network.time,
				queryLength: request.query.length
			});
			return memorySearch(
				this.documents,
				request,
				network.time,
				readModel('meilisearch_unavailable')
			);
		}
	}

	private refreshDocuments(network: NetworkV1): void {
		if (this.indexedNetworkTime === network.time) return;
		this.documents = buildNetworkSearchDocuments(network);
		this.indexedNetworkTime = network.time;
		this.indexReady = false;
		this.syncFailed = false;
		this.syncPromise = undefined;
	}

	private syncIndex(): Promise<void> {
		if (!this.index || this.indexReady) return Promise.resolve();
		if (this.syncPromise) return this.syncPromise;

		const networkTime = this.indexedNetworkTime;
		const documents = [...this.documents];
		const syncPromise = this.writeIndex(documents, networkTime)
			.then(() => {
				if (this.indexedNetworkTime !== networkTime) return;
				this.indexReady = true;
				this.syncFailed = false;
				this.logger?.info('Network search Meilisearch index synced', {
					documentCount: documents.length,
					indexName: this.indexName,
					networkTime
				});
			})
			.catch((error: unknown) => {
				this.syncFailed = true;
				this.logger?.error('Network search Meilisearch sync failed', {
					error: errorMessage(error),
					indexName: this.indexName,
					networkTime
				});
			})
			.finally(() => {
				if (this.syncPromise === syncPromise) {
					this.syncPromise = undefined;
				}
			});
		this.syncPromise = syncPromise;

		return syncPromise;
	}

	private startSyncIndex(): void {
		void this.syncIndex();
	}

	private async writeIndex(
		documents: readonly NetworkSearchDocument[],
		networkTime: string | undefined
	): Promise<void> {
		if (!this.index) return;
		if (!this.settingsReady) await this.syncSettings();

		const documentTask = await this.index
			.addDocuments([...documents], { primaryKey: 'id' })
			.waitTask({
				interval: taskPollIntervalMs,
				timeout: documentTaskTimeoutMs
			});
		assertTaskSucceeded(documentTask.status, 'document update');
		if (this.indexedNetworkTime !== networkTime) return;
	}

	private async syncSettings(): Promise<void> {
		if (!this.index || this.settingsReady) return;

		const searchableTask = await this.index
			.updateSettings({
				filterableAttributes: [...FILTERABLE_ATTRIBUTES],
				searchableAttributes: [...SEARCHABLE_ATTRIBUTES],
				sortableAttributes: [...SORTABLE_ATTRIBUTES]
			})
			.waitTask({
				interval: taskPollIntervalMs,
				timeout: settingsTaskTimeoutMs
			});
		assertTaskSucceeded(searchableTask.status, 'settings');

		this.settingsReady = true;
	}
}
