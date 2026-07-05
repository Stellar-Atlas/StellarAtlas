import { createHash } from 'crypto';
import { Meilisearch, type Index } from 'meilisearch';
import type { Logger } from '@core/services/Logger.js';
import type {
	ScpStatementObservation as CrawlerScpStatementObservation,
	StellarValueSummary
} from 'crawler';
import type {
	ScpStatementObservationV1,
	ScpStatementPledgesV1,
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
	'observedAtMs',
	'observedFromPeer',
	'slotIndex',
	'statementType'
] as const;
const sortableAttributes = ['observedAtMs', 'slotIndex'] as const;
const liveFreshnessMs = 30_000;
const liveRetentionMs = 3 * 60 * 1_000;
const retentionCleanupIntervalMs = 30_000;

const mapStellarValueSummary = (
	value: StellarValueSummary
): ScpStatementValueV1 => ({
	closeTime: value.closeTime,
	txSetHash: value.txSetHash,
	upgradeCount: value.upgradeCount,
	value: ''
});

const toSlimPledges = (
	statementType: CrawlerScpStatementObservation['statementType']
): ScpStatementPledgesV1 => {
	const ballot = { counter: 0, value: '' };
	if (statementType === 'nominate') {
		return {
			accepted: [],
			quorumSetHash: '',
			votes: []
		};
	}
	if (statementType === 'prepare') {
		return {
			ballot,
			nC: 0,
			nH: 0,
			prepared: null,
			preparedPrime: null,
			quorumSetHash: ''
		};
	}
	if (statementType === 'confirm') {
		return {
			ballot,
			nCommit: 0,
			nH: 0,
			nPrepared: 0,
			quorumSetHash: ''
		};
	}
	return {
		commit: ballot,
		nH: 0,
		quorumSetHash: ''
	};
};

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
	pledges: toSlimPledges(observation.statementType),
	signature: '',
	slotIndex: observation.slotIndex,
	statementHash: observation.statementHash,
	statementType: observation.statementType,
	statementXdr: '',
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
	private readonly index: Index<ScpStatementSearchDocument> | undefined;
	private indexSetupPromise: Promise<void> | undefined;
	private lastRetentionCleanupAtMs = 0;

	constructor(config: NetworkSearchConfig, private logger?: Logger) {
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

		const documents = observations.map(toDocument);
		await this.index.addDocuments(documents, { primaryKey: 'id' });
		await this.enqueueRetentionCleanup(Date.now());
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
				filter: this.buildFilter({ limit, nodeId, slotIndex }, Date.now()),
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
		this.indexSetupPromise ??= this.enqueueIndexSettings();
		await this.indexSetupPromise;
	}

	private async enqueueIndexSettings(): Promise<void> {
		if (!this.index) return;
		try {
			await this.index.updateSettings({
				filterableAttributes: [...filterableAttributes],
				sortableAttributes: [...sortableAttributes]
			});
			this.indexReady = true;
		} catch (error) {
			this.indexSetupPromise = undefined;
			this.logger?.error('Could not queue live SCP Meilisearch settings', {
				error
			});
			throw error;
		}
	}

	private buildFilter({
		nodeId,
		slotIndex
	}: ScpStatementObservationFilter, nowMs: number): string | undefined {
		const freshAfterMs = nowMs - liveFreshnessMs;
		const filters = [
			`observedAtMs >= ${freshAfterMs}`,
			nodeId ? `nodeId = ${quoteFilterValue(nodeId)}` : undefined,
			slotIndex ? `slotIndex = ${quoteFilterValue(slotIndex)}` : undefined
		].filter((filter): filter is string => filter !== undefined);

		return filters.join(' AND ');
	}

	private async enqueueRetentionCleanup(nowMs: number): Promise<void> {
		if (!this.index) return;
		if (
			nowMs - this.lastRetentionCleanupAtMs <
			retentionCleanupIntervalMs
		) {
			return;
		}
		this.lastRetentionCleanupAtMs = nowMs;
		const cutoffMs = nowMs - liveRetentionMs;

		try {
			await this.index.deleteDocuments({
				filter: `observedAtMs < ${cutoffMs}`
			});
		} catch (error) {
			this.logger?.error('Could not queue live SCP retention cleanup', {
				cutoffMs,
				error
			});
		}
	}
}
