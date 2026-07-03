import { createHash } from 'crypto';
import { Meilisearch, type Index } from 'meilisearch';
import type {
	ScpStatementObservation as CrawlerScpStatementObservation,
	StellarValueSummary
} from 'crawler';
import type {
	ScpStatementObservationV1,
	ScpStatementValueV1
} from 'shared';
import type { ScpStatementObservationFilter } from '../../domain/scp/ScpStatementObservationRepository.js';
import type { ScpStatementLiveStore } from '../../domain/scp/ScpStatementLiveStore.js';
import type { NetworkSearchConfig } from './NetworkSearchTypes.js';

interface ScpStatementSearchDocument extends ScpStatementObservationV1 {
	readonly id: string;
	readonly indexedAt: string;
	readonly observedAtMs: number;
}

const filterableAttributes = [
	'nodeId',
	'observedFromPeer',
	'slotIndex',
	'statementType'
] as const;
const sortableAttributes = ['observedAtMs', 'slotIndex'] as const;
const maxTrackedDocumentIds = 20_000;

const mapStellarValueSummary = (
	value: StellarValueSummary
): ScpStatementValueV1 => ({
	closeTime: value.closeTime,
	txSetHash: value.txSetHash,
	upgradeCount: value.upgradeCount,
	value: value.value
});

const documentId = (statementHash: string): string =>
	createHash('sha256').update(statementHash).digest('hex');

const toDocument = (
	observation: CrawlerScpStatementObservation
): ScpStatementSearchDocument => ({
	id: documentId(observation.statementHash),
	indexedAt: new Date().toISOString(),
	nodeId: observation.nodeId,
	observedAt: observation.observedAt.toISOString(),
	observedAtMs: observation.observedAt.getTime(),
	observedFromAddress: observation.observedFromAddress,
	observedFromPeer: observation.observedFromPeer,
	pledges: observation.pledges,
	signature: observation.signature,
	slotIndex: observation.slotIndex,
	statementHash: observation.statementHash,
	statementType: observation.statementType,
	statementXdr: observation.statementXdr,
	values: observation.values.map(mapStellarValueSummary)
});

const toDTO = (
	document: ScpStatementSearchDocument
): ScpStatementObservationV1 => ({
	nodeId: document.nodeId,
	observedAt: document.observedAt,
	observedFromAddress: document.observedFromAddress,
	observedFromPeer: document.observedFromPeer,
	pledges: document.pledges,
	signature: document.signature,
	slotIndex: document.slotIndex,
	statementHash: document.statementHash,
	statementType: document.statementType,
	statementXdr: document.statementXdr,
	values: document.values
});

const quoteFilterValue = (value: string): string => JSON.stringify(value);

export class MeilisearchScpStatementLiveStore
	implements ScpStatementLiveStore
{
	private indexReady = false;
	private resetOnFirstWrite = true;
	private readonly index: Index<ScpStatementSearchDocument> | undefined;
	private readonly trackedDocumentIds: string[] = [];

	constructor(config: NetworkSearchConfig) {
		if (config.host && config.host.length > 0) {
			const client = new Meilisearch({
				apiKey: config.apiKey,
				host: config.host
			});
			this.index = client.index<ScpStatementSearchDocument>(config.indexName);
		}
	}

	async saveMany(
		observations: readonly CrawlerScpStatementObservation[]
	): Promise<void> {
		if (!this.index || observations.length === 0) return;
		await this.ensureIndexReady();
		if (this.resetOnFirstWrite) {
			await this.index.deleteAllDocuments().waitTask({ interval: 50 });
			this.trackedDocumentIds.length = 0;
			this.resetOnFirstWrite = false;
		}

		const documents = observations.map(toDocument);
		await this.index
			.addDocuments(documents, { primaryKey: 'id' })
			.waitTask({ interval: 50 });
		this.trackDocumentIds(documents.map((document) => document.id));
	}

	async findLatest({
		limit,
		nodeId,
		slotIndex
	}: ScpStatementObservationFilter): Promise<ScpStatementObservationV1[] | null> {
		if (!this.index) return null;

		try {
			await this.ensureIndexReady();
			const response = await this.index.search<ScpStatementSearchDocument>('', {
				filter: this.buildFilter({ limit, nodeId, slotIndex }),
				limit,
				sort: ['observedAtMs:desc']
			});
			return response.hits.map(toDTO);
		} catch {
			return null;
		}
	}

	private async ensureIndexReady(): Promise<void> {
		if (!this.index || this.indexReady) return;
		await this.index
			.updateFilterableAttributes([...filterableAttributes])
			.waitTask({ interval: 50 });
		await this.index
			.updateSortableAttributes([...sortableAttributes])
			.waitTask({ interval: 50 });
		this.indexReady = true;
	}

	private buildFilter({
		nodeId,
		slotIndex
	}: ScpStatementObservationFilter): string | undefined {
		const filters = [
			nodeId ? `nodeId = ${quoteFilterValue(nodeId)}` : undefined,
			slotIndex ? `slotIndex = ${quoteFilterValue(slotIndex)}` : undefined
		].filter((filter): filter is string => filter !== undefined);

		return filters.length > 0 ? filters.join(' AND ') : undefined;
	}

	private trackDocumentIds(ids: readonly string[]): void {
		this.trackedDocumentIds.push(...ids);
		if (
			!this.index ||
			this.trackedDocumentIds.length <= maxTrackedDocumentIds
		) {
			return;
		}

		const expiredIds = this.trackedDocumentIds.splice(
			0,
			this.trackedDocumentIds.length - maxTrackedDocumentIds
		);
		void this.index.deleteDocuments(expiredIds).waitTask({ interval: 50 });
	}
}
