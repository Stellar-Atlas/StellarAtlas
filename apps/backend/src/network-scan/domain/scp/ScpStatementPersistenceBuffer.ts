import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';
import type { ScpStatementObservation as CrawlerScpStatementObservation } from 'crawler';
import type { ScpStatementObservationRepository } from './ScpStatementObservationRepository.js';
import { scpStatementObservationPolicy } from './ScpStatementObservationPolicy.js';
import {
	ScpStatementPersistenceCapacityError,
	ScpStatementPersistenceClosedError,
	ScpStatementPersistenceFatalError,
	isRetryableScpStatementPersistenceError
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
	onRetry?: (retry: ScpStatementPersistenceRetry) => void;
	random?: () => number;
	retryInitialDelayMs?: number;
	retryJitterRatio?: number;
	retryMaxDelayMs?: number;
}

interface ScpStatementPersistenceRetry {
	attempt: number;
	batchSize: number;
	delayMs: number;
	error: Error;
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
	private readonly onRetry:
		((retry: ScpStatementPersistenceRetry) => void) | undefined;
	private readonly random: () => number;
	private readonly retryInitialDelayMs: number;
	private readonly retryJitterRatio: number;
	private readonly retryMaxDelayMs: number;
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
		this.onRetry = options.onRetry;
		this.random = options.random ?? Math.random;
		this.retryInitialDelayMs =
			options.retryInitialDelayMs ??
			scpStatementObservationPolicy.persistenceRetryInitialDelayMs;
		this.retryJitterRatio = Math.min(
			1,
			Math.max(
				0,
				options.retryJitterRatio ??
					scpStatementObservationPolicy.persistenceRetryJitterRatio
			)
		);
		this.retryMaxDelayMs = Math.max(
			this.retryInitialDelayMs,
			options.retryMaxDelayMs ??
				scpStatementObservationPolicy.persistenceRetryMaxDelayMs
		);
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
		let retryAttempt = 0;
		try {
			while (true) {
				try {
					await this.repository.saveMany(observations, 'scp_live_collector');
					break;
				} catch (error) {
					const failure = mapUnknownToError(error);
					if (!isRetryableScpStatementPersistenceError(error)) {
						this.fail(batch, new ScpStatementPersistenceFatalError(failure));
						return;
					}

					const delayMs = this.retryDelayMs(retryAttempt);
					retryAttempt += 1;
					this.notifyRetry({
						attempt: retryAttempt,
						batchSize: observations.length,
						delayMs,
						error: failure
					});
					await sleep(delayMs);
				}
			}
			for (const pending of batch) pending.resolve();
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

	private fail(batch: PendingObservation[], failure: Error): void {
		this.failure = failure;
		for (const pending of batch) pending.reject(failure);
		for (const pending of this.pending.splice(0)) {
			pending.reject(failure);
		}
	}

	private notifyRetry(retry: ScpStatementPersistenceRetry): void {
		try {
			this.onRetry?.(retry);
		} catch {
			// Persistence must not fail because an observability callback failed.
		}
	}

	private retryDelayMs(attempt: number): number {
		const exponent = Math.min(30, Math.max(0, attempt));
		const baseDelayMs = Math.min(
			this.retryMaxDelayMs,
			this.retryInitialDelayMs * 2 ** exponent
		);
		const boundedRandom = Math.min(1, Math.max(0, this.random()));
		const jitterMultiplier =
			1 - this.retryJitterRatio + 2 * this.retryJitterRatio * boundedRandom;
		return Math.min(
			this.retryMaxDelayMs,
			Math.max(0, Math.round(baseDelayMs * jitterMultiplier))
		);
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

function sleep(delayMs: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, delayMs));
}
