import { createHash } from 'crypto';
import { Meilisearch, type Index } from 'meilisearch';
import type { Logger } from '@core/services/Logger.js';
import type {
	ScpStatementObservation as CrawlerScpStatementObservation,
	StellarValueSummary
} from 'crawler';
import type {
	ScpStatementPledgesV1,
	ScpStatementObservationV1,
	ScpStatementValueV1
} from 'shared';
import type {
	ScpStatementLiveCursor,
	ScpStatementLiveFilter,
	ScpStatementLiveOrder,
	ScpStatementLiveStore
} from '../../domain/scp/ScpStatementLiveStore.js';
import {
	assertMeilisearchTaskSucceeded,
	ensureMeilisearchSettings
} from './MeilisearchIndexSettings.js';
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
	'statementHash',
	'statementType'
] as const;
const sortableAttributes = [
	'observedAtMs',
	'slotIndex',
	'statementHash'
] as const;
const liveFreshnessMs = 2 * 60 * 1_000;
const liveRetentionMs = 5 * 60 * 1_000;
const retentionCleanupIntervalMs = 30_000;
const pendingDocumentTaskPollIntervalMs = 5_000;
const taskPollIntervalMs = 50;
const settingsTaskTimeoutMs = 60_000;
const settingsRetryCooldownMs = 60_000;
const documentWriteRetryCooldownMs = 60_000;
const requiredSettings = {
	filterableAttributes,
	sortableAttributes
};

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

const errorMessage = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

export class MeilisearchScpStatementLiveStore implements ScpStatementLiveStore {
	private indexReady = false;
	private readonly index: Index<ScpStatementSearchDocument> | undefined;
	private indexSetupPromise: Promise<void> | undefined;
	private lastRetentionCleanupAtMs = 0;
	private nextDocumentWriteAttemptAtMs = 0;
	private nextIndexSetupAttemptAtMs = 0;
	private pendingDocumentTaskCheckedAtMs = 0;
	private pendingDocumentTaskUid: number | undefined;

	constructor(
		config: NetworkSearchConfig,
		private logger?: Logger,
		index?: Index<ScpStatementSearchDocument>
	) {
		if (index) {
			this.index = index;
		} else if (config.host && config.host.length > 0) {
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
		const nowMs = Date.now();
		if (nowMs < this.nextDocumentWriteAttemptAtMs) return;
		if (!this.indexReady) {
			this.queueIndexSetup(nowMs);
			return;
		}
		if (await this.hasPendingDocumentTask(nowMs)) return;

		const documents = observations.map(toDocument);
		try {
			const documentTask = await this.index.addDocuments(documents, {
				primaryKey: 'id'
			});
			this.pendingDocumentTaskUid = documentTask.taskUid;
			this.pendingDocumentTaskCheckedAtMs = Date.now();
		} catch (error) {
			this.nextDocumentWriteAttemptAtMs =
				Date.now() + documentWriteRetryCooldownMs;
			this.logger?.warn('Could not enqueue live SCP Meilisearch documents', {
				cooldownMs: documentWriteRetryCooldownMs,
				error: errorMessage(error)
			});
			return;
		}
		await this.enqueueRetentionCleanup(Date.now());
	}

	async findLatest({
		after,
		limit,
		nodeId,
		order,
		slotIndex
	}: ScpStatementLiveFilter): Promise<ScpStatementObservationV1[] | null> {
		if (!this.index) return null;

		try {
			if (!(await this.ensureIndexReady())) return null;
			const response = await this.index.search<ScpStatementSearchDocument>('', {
				filter: this.buildFilter(
					{ after, limit, nodeId, order, slotIndex },
					Date.now()
				),
				limit,
				sort: this.buildSort(order)
			});
			return response.hits.map(toDTO);
		} catch (error) {
			this.logger?.error('Could not read live SCP Meilisearch index', {
				error: errorMessage(error)
			});
			return null;
		}
	}

	private async ensureIndexReady(nowMs = Date.now()): Promise<boolean> {
		if (!this.index) return false;
		if (this.indexReady) return true;
		if (nowMs < this.nextIndexSetupAttemptAtMs) return false;
		this.queueIndexSetup(nowMs);
		await this.indexSetupPromise;
		return this.indexReady;
	}

	private queueIndexSetup(nowMs = Date.now()): void {
		if (!this.index) return;
		if (this.indexReady) return;
		if (nowMs < this.nextIndexSetupAttemptAtMs) return;
		this.indexSetupPromise ??= this.enqueueIndexSettings().finally(() => {
			if (!this.indexReady) this.indexSetupPromise = undefined;
		});
	}

	private async enqueueIndexSettings(): Promise<void> {
		if (!this.index) return;
		try {
			await ensureMeilisearchSettings(
				this.index,
				requiredSettings,
				{
					interval: taskPollIntervalMs,
					timeout: settingsTaskTimeoutMs
				},
				'live SCP settings'
			);
			this.indexReady = true;
			this.nextIndexSetupAttemptAtMs = 0;
		} catch (error) {
			this.nextIndexSetupAttemptAtMs = Date.now() + settingsRetryCooldownMs;
			this.logger?.error('Could not queue live SCP Meilisearch settings', {
				error: errorMessage(error)
			});
		}
	}

	private async hasPendingDocumentTask(nowMs: number): Promise<boolean> {
		if (!this.index || this.pendingDocumentTaskUid === undefined) return false;
		if (
			nowMs - this.pendingDocumentTaskCheckedAtMs <
			pendingDocumentTaskPollIntervalMs
		) {
			return true;
		}

		this.pendingDocumentTaskCheckedAtMs = nowMs;
		try {
			const task = await this.index.tasks.getTask(this.pendingDocumentTaskUid);
			if (task.status === 'enqueued' || task.status === 'processing') return true;
			this.pendingDocumentTaskUid = undefined;
			if (task.status === 'succeeded') return false;
			this.nextDocumentWriteAttemptAtMs =
				Date.now() + documentWriteRetryCooldownMs;
			this.logger?.warn('Live SCP Meilisearch document task did not succeed', {
				cooldownMs: documentWriteRetryCooldownMs,
				status: task.status,
				taskUid: task.uid
			});
			return true;
		} catch (error) {
			this.nextDocumentWriteAttemptAtMs =
				Date.now() + documentWriteRetryCooldownMs;
			this.logger?.warn('Could not read live SCP Meilisearch document task', {
				cooldownMs: documentWriteRetryCooldownMs,
				error: errorMessage(error),
				taskUid: this.pendingDocumentTaskUid
			});
			return true;
		}
	}

	private buildFilter(
		{ after, nodeId, slotIndex }: ScpStatementLiveFilter,
		nowMs: number
	): string | undefined {
		const freshAfterMs = nowMs - liveFreshnessMs;
		const filters = [
			`observedAtMs >= ${freshAfterMs}`,
			after ? this.buildCursorFilter(after) : undefined,
			nodeId ? `nodeId = ${quoteFilterValue(nodeId)}` : undefined,
			slotIndex ? `slotIndex = ${quoteFilterValue(slotIndex)}` : undefined
		].filter((filter): filter is string => filter !== undefined);

		return filters.join(' AND ');
	}

	private buildCursorFilter(after: ScpStatementLiveCursor): string {
		return `(${[
			`observedAtMs > ${after.observedAtMs}`,
			`(observedAtMs = ${after.observedAtMs} AND statementHash > ${quoteFilterValue(after.statementHash)})`
		].join(' OR ')})`;
	}

	private buildSort(order: ScpStatementLiveOrder | undefined): string[] {
		const direction = order === 'asc' ? 'asc' : 'desc';
		return [`observedAtMs:${direction}`, `statementHash:${direction}`];
	}

	private async enqueueRetentionCleanup(nowMs: number): Promise<void> {
		if (!this.index) return;
		if (nowMs - this.lastRetentionCleanupAtMs < retentionCleanupIntervalMs) {
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
