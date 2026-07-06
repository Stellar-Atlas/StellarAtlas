import type { Logger } from '@core/services/Logger.js';
import type { ScpStatementObservation as CrawlerScpStatementObservation } from 'crawler';
import type { ScpStatementLiveStore } from './ScpStatementLiveStore.js';

interface ScpStatementLiveStoreBufferOptions {
	batchSize?: number;
	flushDelayMs?: number;
}

const defaultBatchSize = 1_000;
const defaultFlushDelayMs = 1_500;

export class ScpStatementLiveStoreBuffer {
	private aborted = false;
	private abortFlush: () => void = () => {};
	private readonly abortPromise: Promise<void>;
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
		this.abortPromise = new Promise((resolve) => {
			this.abortFlush = resolve;
		});
	}

	add(observation: CrawlerScpStatementObservation): void {
		if (this.aborted) return;
		this.buffer.push(observation);
		if (this.buffer.length >= this.batchSize) {
			void this.flush();
			return;
		}
		this.scheduleFlush();
	}

	async flush(): Promise<void> {
		this.clearFlushTimer();
		if (this.aborted) {
			this.buffer = [];
			return;
		}

		const batch = this.buffer.splice(0);
		if (batch.length === 0) {
			await this.waitForActiveFlush();
			return;
		}

		this.flushPromise = this.flushPromise.then(async () => {
			if (this.aborted) return;
			try {
				await this.liveStore.saveMany(batch);
			} catch (error) {
				this.logger.error('Error while indexing live SCP statements', {
					error
				});
			}
		});
		await this.waitForActiveFlush();
	}

	abort(): void {
		if (this.aborted) return;
		this.aborted = true;
		this.buffer = [];
		this.clearFlushTimer();
		this.abortFlush();
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

	private async waitForActiveFlush(): Promise<void> {
		if (this.aborted) return;
		await Promise.race([this.flushPromise, this.abortPromise]);
	}
}
