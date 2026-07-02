import { Meilisearch, type Index } from 'meilisearch';
import type { NetworkV1 } from 'shared';
import { buildNetworkSearchDocuments } from './NetworkSearchDocumentBuilder.js';
import type {
	NetworkSearchConfig,
	NetworkSearchDocument,
	NetworkSearchHit,
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

const SORTABLE_ATTRIBUTES = ['label', 'networkTime', 'latestLedger'] as const;

const sanitizeLimit = (limit: number): number => {
	if (!Number.isInteger(limit)) return 8;
	return Math.min(Math.max(limit, 1), 50);
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

	const query = normalize(request.query);
	if (query.length === 0) return true;

	return normalize(document.content).includes(query);
};

const memorySearch = (
	documents: readonly NetworkSearchDocument[],
	request: NetworkSearchRequest,
	networkTime: string
): NetworkSearchResponse => {
	const matching = documents.filter((document) =>
		matchesDocument(document, request)
	);

	return {
		estimatedTotalHits: matching.length,
		hits: matching.slice(0, sanitizeLimit(request.limit)).map(toHit),
		indexedNetworkTime: networkTime,
		query: request.query,
		source: 'memory'
	};
};

const quoteFilterValue = (value: string): string => JSON.stringify(value);

const assertTaskSucceeded = (status: string, taskName: string): void => {
	if (status !== 'succeeded')
		throw new Error(`Meilisearch ${taskName} task ended with ${status}`);
};

export class NetworkSearchService {
	private documents: readonly NetworkSearchDocument[] = [];
	private indexedNetworkTime: string | undefined;
	private indexReady = false;
	private readonly index: Index<NetworkSearchDocument> | undefined;
	private syncPromise: Promise<void> | undefined;

	constructor(config: NetworkSearchConfig) {
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
			return memorySearch(this.documents, request, network.time);
		}

		try {
			await this.syncIndex();
			const filter = request.entityType
				? `entityType = ${quoteFilterValue(request.entityType)}`
				: undefined;
			const response = await this.index.search<NetworkSearchDocument>(
				request.query,
				{
					filter,
					limit: sanitizeLimit(request.limit)
				}
			);

			return {
				estimatedTotalHits: response.estimatedTotalHits,
				hits: response.hits.map(toHit),
				indexedNetworkTime: network.time,
				query: request.query,
				source: 'meilisearch'
			};
		} catch {
			return memorySearch(this.documents, request, network.time);
		}
	}

	private refreshDocuments(network: NetworkV1): void {
		if (this.indexedNetworkTime === network.time) return;
		this.documents = buildNetworkSearchDocuments(network);
		this.indexedNetworkTime = network.time;
		this.indexReady = false;
		this.syncPromise = undefined;
	}

	private async syncIndex(): Promise<void> {
		if (!this.index || this.indexReady) return;
		if (this.syncPromise) return this.syncPromise;

		this.syncPromise = this.writeIndex();
		await this.syncPromise;
	}

	private async writeIndex(): Promise<void> {
		if (!this.index) return;

		const searchableTask = await this.index
			.updateSearchableAttributes([...SEARCHABLE_ATTRIBUTES])
			.waitTask({ interval: 50, timeout: 1_500 });
		assertTaskSucceeded(searchableTask.status, 'searchable attributes');

		const filterableTask = await this.index
			.updateFilterableAttributes([...FILTERABLE_ATTRIBUTES])
			.waitTask({ interval: 50, timeout: 1_500 });
		assertTaskSucceeded(filterableTask.status, 'filterable attributes');

		const sortableTask = await this.index
			.updateSortableAttributes([...SORTABLE_ATTRIBUTES])
			.waitTask({ interval: 50, timeout: 1_500 });
		assertTaskSucceeded(sortableTask.status, 'sortable attributes');

		const documentTask = await this.index
			.addDocuments([...this.documents], { primaryKey: 'id' })
			.waitTask({ interval: 50, timeout: 2_500 });
		assertTaskSucceeded(documentTask.status, 'document update');

		this.indexReady = true;
	}
}
