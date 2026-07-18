import { createHash } from 'crypto';
import { Meilisearch, type Index } from 'meilisearch';
import type { Logger } from '@core/services/Logger.js';
import type {
	ScpStatementObservation as CrawlerScpStatementObservation,
	StellarValueSummary
} from 'crawler';
import type { ScpStatementObservationV1, ScpStatementValueV1 } from 'shared';
import type {
	ScpStatementLiveCursor,
	ScpStatementLiveFilter,
	ScpStatementLiveOrder,
	ScpStatementProjectionOutcome,
	ScpStatementProjectionTaskOutcome,
	ScpStatementLiveStore
} from '../../domain/scp/ScpStatementLiveStore.js';
import { ensureMeilisearchSettings } from './MeilisearchIndexSettings.js';
import type { NetworkSearchConfig } from './NetworkSearchTypes.js';
import { scpStatementObservationPolicy } from '../../domain/scp/ScpStatementObservationPolicy.js';

interface ScpStatementSearchDocument extends ScpStatementObservationV1 {
	readonly id: string;
	readonly observedAtMs: number;
}

const filterableAttributes = [
	'nodeId',
	'observedAtMs',
	'slotIndex',
	'statementHash'
] as const;
const sortableAttributes = ['observedAtMs', 'statementHash'] as const;
const liveFreshnessMs = 2 * 60 * 1_000;
const liveRetentionMs = 5 * 60 * 1_000;
const retentionCleanupIntervalMs = liveRetentionMs;
const retentionCleanupHysteresisMs = 30_000;
const pendingDocumentTaskPollIntervalMs = 5_000;
const taskPollIntervalMs = 50;
const settingsTaskTimeoutMs = 60_000;
const settingsRetryCooldownMs = 60_000;
const documentWriteRetryCooldownMs = 60_000;
const requiredSettings = {
	filterableAttributes,
	searchableAttributes: [],
	sortableAttributes
};

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
	private pendingRetentionCleanupTaskUid: number | undefined;
	private retentionCleanupPromise: Promise<void> | undefined;
	private retentionCleanupTimer: ReturnType<typeof setTimeout> | undefined;

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
				host: config.host,
				timeout: scpStatementObservationPolicy.projectionTimeoutMs
			});
			this.index = client.index<ScpStatementSearchDocument>(config.indexName);
		}
	}

	async saveMany(
		observations: readonly CrawlerScpStatementObservation[]
	): Promise<ScpStatementProjectionOutcome> {
		if (observations.length === 0) return { status: 'accepted' };
		if (!this.index) {
			return { reason: 'index-unavailable', status: 'deferred' };
		}
		const nowMs = Date.now();
		if (nowMs < this.nextDocumentWriteAttemptAtMs) {
			return {
				reason: 'write-cooldown',
				retryAfterMs: this.nextDocumentWriteAttemptAtMs - nowMs,
				status: 'deferred'
			};
		}
		if (!this.indexReady) {
			this.queueIndexSetup(nowMs);
			return { reason: 'index-setup', status: 'deferred' };
		}
		const reconciliation = await this.reconcilePendingTask(nowMs);
		if (reconciliation.status === 'pending') {
			return {
				reason: 'document-task-pending',
				retryAfterMs: reconciliation.retryAfterMs,
				status: 'deferred'
			};
		}
		if (reconciliation.status === 'failed') {
			return {
				reason: reconciliation.reason,
				retryAfterMs: reconciliation.retryAfterMs,
				status: 'deferred'
			};
		}

		const documents = observations.map(toDocument);
		const cleanupWasScheduled = this.clearRetentionCleanupTimer();
		try {
			const documentTask = await this.index.addDocuments(documents, {
				primaryKey: 'id'
			});
			this.pendingDocumentTaskUid = documentTask.taskUid;
			this.pendingDocumentTaskCheckedAtMs = Date.now();
		} catch (error) {
			if (cleanupWasScheduled) this.scheduleRetentionCleanup(Date.now());
			this.nextDocumentWriteAttemptAtMs =
				Date.now() + documentWriteRetryCooldownMs;
			this.logger?.warn('Could not enqueue live SCP Meilisearch documents', {
				cooldownMs: documentWriteRetryCooldownMs,
				error: errorMessage(error)
			});
			return {
				reason: 'document-write-failed',
				retryAfterMs: documentWriteRetryCooldownMs,
				status: 'deferred'
			};
		}
		return { status: 'accepted', taskPending: true };
	}

	async reconcilePendingTask(
		nowMs = Date.now()
	): Promise<ScpStatementProjectionTaskOutcome> {
		if (!this.index || this.pendingDocumentTaskUid === undefined) {
			return { status: 'settled' };
		}
		const elapsedMs = nowMs - this.pendingDocumentTaskCheckedAtMs;
		if (elapsedMs < pendingDocumentTaskPollIntervalMs) {
			return {
				retryAfterMs: pendingDocumentTaskPollIntervalMs - elapsedMs,
				status: 'pending'
			};
		}

		this.pendingDocumentTaskCheckedAtMs = nowMs;
		try {
			const task = await this.index.tasks.getTask(this.pendingDocumentTaskUid);
			if (task.status === 'enqueued' || task.status === 'processing') {
				return {
					retryAfterMs: pendingDocumentTaskPollIntervalMs,
					status: 'pending'
				};
			}
			this.pendingDocumentTaskUid = undefined;
			if (task.status === 'succeeded') {
				this.scheduleRetentionCleanup(nowMs);
				return { status: 'settled' };
			}
			this.nextDocumentWriteAttemptAtMs =
				Date.now() + documentWriteRetryCooldownMs;
			this.logger?.warn('Live SCP Meilisearch document task did not succeed', {
				cooldownMs: documentWriteRetryCooldownMs,
				status: task.status,
				taskUid: task.uid
			});
			return {
				reason: `document-task-${task.status}`,
				retryAfterMs: documentWriteRetryCooldownMs,
				status: 'failed'
			};
		} catch (error) {
			this.nextDocumentWriteAttemptAtMs =
				Date.now() + documentWriteRetryCooldownMs;
			this.logger?.warn('Could not read live SCP Meilisearch document task', {
				cooldownMs: documentWriteRetryCooldownMs,
				error: errorMessage(error),
				taskUid: this.pendingDocumentTaskUid
			});
			return {
				retryAfterMs: documentWriteRetryCooldownMs,
				status: 'pending'
			};
		}
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

	private buildFilter(
		{ after, nodeId, order, slotIndex }: ScpStatementLiveFilter,
		nowMs: number
	): string | undefined {
		const freshAfterMs = nowMs - liveFreshnessMs;
		const filters = [
			`observedAtMs >= ${freshAfterMs}`,
			after ? this.buildCursorFilter(after, order) : undefined,
			nodeId ? `nodeId = ${quoteFilterValue(nodeId)}` : undefined,
			slotIndex ? `slotIndex = ${quoteFilterValue(slotIndex)}` : undefined
		].filter((filter): filter is string => filter !== undefined);

		return filters.join(' AND ');
	}

	private buildCursorFilter(
		after: ScpStatementLiveCursor,
		order: ScpStatementLiveOrder | undefined
	): string {
		const comparison = order === 'asc' ? '>' : '<';
		return `(${[
			`observedAtMs ${comparison} ${after.observedAtMs}`,
			`(observedAtMs = ${after.observedAtMs} AND statementHash ${comparison} ${quoteFilterValue(after.statementHash)})`
		].join(' OR ')})`;
	}

	private buildSort(order: ScpStatementLiveOrder | undefined): string[] {
		const direction = order === 'asc' ? 'asc' : 'desc';
		return [`observedAtMs:${direction}`, `statementHash:${direction}`];
	}

	private async enqueueRetentionCleanup(nowMs: number): Promise<void> {
		if (!this.index) return;
		if (this.pendingDocumentTaskUid !== undefined) return;
		if (nowMs - this.lastRetentionCleanupAtMs < retentionCleanupIntervalMs) {
			return;
		}
		if (await this.hasPendingRetentionCleanupTask()) return;
		const cutoffMs = nowMs - liveRetentionMs;

		try {
			const cleanupTask = await this.index.deleteDocuments({
				filter: `observedAtMs < ${cutoffMs}`
			});
			this.lastRetentionCleanupAtMs = nowMs;
			this.pendingRetentionCleanupTaskUid = cleanupTask.taskUid;
		} catch (error) {
			this.logger?.error('Could not queue live SCP retention cleanup', {
				cutoffMs,
				error: errorMessage(error)
			});
		}
	}

	private async hasPendingRetentionCleanupTask(): Promise<boolean> {
		if (!this.index || this.pendingRetentionCleanupTaskUid === undefined) {
			return false;
		}
		const taskUid = this.pendingRetentionCleanupTaskUid;
		try {
			const task = await this.index.tasks.getTask(taskUid);
			if (task.status === 'enqueued' || task.status === 'processing') {
				return true;
			}
			this.pendingRetentionCleanupTaskUid = undefined;
			if (task.status !== 'succeeded') {
				this.logger?.error(
					'Live SCP Meilisearch retention cleanup task did not succeed',
					{ status: task.status, taskUid }
				);
			}
			return false;
		} catch (error) {
			this.logger?.error(
				'Could not read live SCP Meilisearch retention cleanup task',
				{ error: errorMessage(error), taskUid }
			);
			return true;
		}
	}

	private scheduleRetentionCleanup(nowMs: number): void {
		if (
			!this.index ||
			this.pendingDocumentTaskUid !== undefined ||
			this.retentionCleanupPromise !== undefined ||
			this.retentionCleanupTimer !== undefined
		) {
			return;
		}
		const cadenceDelayMs = Math.max(
			0,
			this.lastRetentionCleanupAtMs + retentionCleanupIntervalMs - nowMs
		);
		const delayMs = Math.max(retentionCleanupHysteresisMs, cadenceDelayMs);
		this.retentionCleanupTimer = setTimeout(() => {
			this.retentionCleanupTimer = undefined;
			if (this.pendingDocumentTaskUid !== undefined) return;
			this.retentionCleanupPromise = this.enqueueRetentionCleanup(
				Date.now()
			).finally(() => {
				this.retentionCleanupPromise = undefined;
			});
		}, delayMs);
		this.retentionCleanupTimer.unref();
	}

	private clearRetentionCleanupTimer(): boolean {
		if (this.retentionCleanupTimer === undefined) return false;
		clearTimeout(this.retentionCleanupTimer);
		this.retentionCleanupTimer = undefined;
		return true;
	}
}
