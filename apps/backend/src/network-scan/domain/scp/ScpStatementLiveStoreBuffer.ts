import type { Logger } from '@core/services/Logger.js';
import type { ScpStatementObservation as CrawlerScpStatementObservation } from 'crawler';
import type { ScpStatementLiveStore } from './ScpStatementLiveStore.js';

interface ScpStatementLiveStoreBufferOptions {
	batchSize?: number;
	flushDelayMs?: number;
}

const defaultBatchSize = 250;
const defaultFlushDelayMs = 500;

export class ScpStatementLiveStoreBuffer {
	private buffer: CrawlerScpStatementObservation[] = [];
	private flushPromise: Promise<void> = Promise.resolve();
	private flushTimer: ReturnType<typeof setTimeout> | undefined;
	private readonly batchSize: number;
	private readonly flushDelayMs: number;

	constructor(
		private liveStore: ScpStatementLiveStore,
		private logger: Logger,
		options: ScpStatementLiveStoreBufferOptions = {}
	) {
		this.batchSize = options.batchSize ?? defaultBatchSize;
		this.flushDelayMs = options.flushDelayMs ?? defaultFlushDelayMs;
	}

	add(observation: CrawlerScpStatementObservation): void {
		this.buffer.push(observation);
		if (this.buffer.length >= this.batchSize) {
			void this.flush();
			return;
		}
		this.scheduleFlush();
	}

	async flush(): Promise<void> {
		this.clearFlushTimer();
		const batch = this.buffer.splice(0);
		if (batch.length === 0) {
			await this.flushPromise;
			return;
		}

		this.flushPromise = this.flushPromise.then(async () => {
			try {
				await this.liveStore.saveMany(batch);
			} catch (error) {
				this.logger.error('Error while indexing live SCP statements', {
					error
				});
			}
		});
		await this.flushPromise;
	}

	private scheduleFlush(): void {
		if (this.flushTimer !== undefined) return;
		this.flushTimer = setTimeout(() => {
			void this.flush();
		}, this.flushDelayMs);
	}

	private clearFlushTimer(): void {
		if (this.flushTimer === undefined) return;
		clearTimeout(this.flushTimer);
		this.flushTimer = undefined;
	}
}
