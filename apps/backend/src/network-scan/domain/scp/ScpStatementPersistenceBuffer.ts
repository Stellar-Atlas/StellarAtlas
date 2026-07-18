import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';
import type { ScpStatementObservation as CrawlerScpStatementObservation } from 'crawler';
import type { ScpStatementObservationRepository } from './ScpStatementObservationRepository.js';
import { scpStatementObservationPolicy } from './ScpStatementObservationPolicy.js';
import {
	ScpStatementPersistenceCapacityError,
	ScpStatementPersistenceClosedError,
	ScpStatementPersistenceTimeoutError
} from './ScpStatementPersistenceError.js';
interface PendingObservation {
	observation: CrawlerScpStatementObservation;
	reject: (error: Error) => void;
	resolve: () => void;
}

interface ScpStatementPersistenceBufferOptions {
	batchSize?: number;
	flushDelayMs?: number;
	maxBufferedObservations?: number;
	saveTimeoutMs?: number;
}

export class ScpStatementPersistenceBuffer {
	private readonly batchSize: number;
	private activeBatchSize = 0;
	private closed = false;
	private drainWaiters: Array<{
		reject: (error: Error) => void;
		resolve: () => void;
	}> = [];
	private failure: Error | null = null;
	private readonly flushDelayMs: number;
	private flushRequested = false;
	private flushTimer: ReturnType<typeof setTimeout> | undefined;
	private pending: PendingObservation[] = [];
	private persisting = false;
	private readonly maxBufferedObservations: number;
	private readonly saveTimeoutMs: number;
	private readonly accepted = new WeakMap<
		CrawlerScpStatementObservation,
		Promise<void>
	>();

	constructor(
		private readonly repository: ScpStatementObservationRepository,
		options: ScpStatementPersistenceBufferOptions = {}
	) {
		this.batchSize =
			options.batchSize ?? scpStatementObservationPolicy.persistenceBatchSize;
		this.flushDelayMs =
			options.flushDelayMs ??
			scpStatementObservationPolicy.persistenceFlushDelayMs;
		this.maxBufferedObservations =
			options.maxBufferedObservations ??
			scpStatementObservationPolicy.persistenceMaxBufferedObservations;
		this.saveTimeoutMs =
			options.saveTimeoutMs ??
			scpStatementObservationPolicy.persistenceSaveTimeoutMs;
	}

	add(observation: CrawlerScpStatementObservation): Promise<void> {
		if (this.failure !== null) return Promise.reject(this.failure);
		if (this.closed) {
			return Promise.reject(new ScpStatementPersistenceClosedError());
		}
		const existing = this.accepted.get(observation);
		if (existing !== undefined) return existing;
		if (this.bufferedObservationCount >= this.maxBufferedObservations) {
			return Promise.reject(
				new ScpStatementPersistenceCapacityError(this.maxBufferedObservations)
			);
		}

		const committed = new Promise<void>((resolve, reject) => {
			this.pending.push({ observation, reject, resolve });
		});
		this.accepted.set(observation, committed);
		if (this.pending.length >= this.batchSize) this.pump();
		else this.scheduleFlush();
		return committed;
	}

	close(): void {
		this.closed = true;
		this.clearFlushTimer();
	}

	async closeAndFlush(): Promise<void> {
		this.close();
		await this.flush();
	}

	async flush(): Promise<void> {
		this.clearFlushTimer();
		this.flushRequested = true;
		this.pump();
		if (!this.persisting && this.pending.length === 0) {
			this.flushRequested = false;
			if (this.failure !== null) throw this.failure;
			return;
		}

		await new Promise<void>((resolve, reject) => {
			this.drainWaiters.push({ reject, resolve });
		});
	}

	private pump(): void {
		if (this.persisting || this.failure !== null) return;
		if (
			this.pending.length < this.batchSize &&
			(!this.flushRequested || this.pending.length === 0)
		) {
			return;
		}

		this.clearFlushTimer();
		const batch = this.pending.splice(0, this.batchSize);
		this.persisting = true;
		this.activeBatchSize = batch.length;
		void this.persist(batch);
	}

	private async persist(batch: PendingObservation[]): Promise<void> {
		const observations = batch.map(({ observation }) => observation);
		try {
			await this.saveWithTimeout(observations);
			for (const pending of batch) pending.resolve();
		} catch (error) {
			this.failure = mapUnknownToError(error);
			for (const pending of batch) pending.reject(this.failure);
			for (const pending of this.pending.splice(0)) {
				pending.reject(this.failure);
			}
		} finally {
			this.persisting = false;
			this.activeBatchSize = 0;
			if (this.failure === null && this.pending.length > 0) {
				if (this.flushRequested || this.pending.length >= this.batchSize) {
					this.pump();
				} else {
					this.scheduleFlush();
				}
			} else {
				this.finishDrain();
			}
		}
	}

	private async saveWithTimeout(
		observations: readonly CrawlerScpStatementObservation[]
	): Promise<void> {
		let timeout: ReturnType<typeof setTimeout> | undefined;
		const timedOut = new Promise<never>((_, reject) => {
			timeout = setTimeout(
				() =>
					reject(new ScpStatementPersistenceTimeoutError(this.saveTimeoutMs)),
				this.saveTimeoutMs
			);
		});

		try {
			await Promise.race([
				this.repository.saveMany(observations, 'scp_live_collector'),
				timedOut
			]);
		} finally {
			if (timeout !== undefined) clearTimeout(timeout);
		}
	}

	private finishDrain(): void {
		this.flushRequested = false;
		const waiters = this.drainWaiters.splice(0);
		for (const waiter of waiters) {
			if (this.failure !== null) waiter.reject(this.failure);
			else waiter.resolve();
		}
	}

	private scheduleFlush(): void {
		if (this.flushTimer !== undefined || this.flushRequested) return;
		this.flushTimer = setTimeout(() => {
			this.flushTimer = undefined;
			this.flushRequested = true;
			this.pump();
		}, this.flushDelayMs);
	}

	private clearFlushTimer(): void {
		if (this.flushTimer === undefined) return;
		clearTimeout(this.flushTimer);
		this.flushTimer = undefined;
	}

	private get bufferedObservationCount(): number {
		return this.activeBatchSize + this.pending.length;
	}
}
