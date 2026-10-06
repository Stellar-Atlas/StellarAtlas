import { err, type Result } from 'neverthrow';
import { mapUnknownToError } from 'shared';
import type { Logger } from 'logger';
import type { HistoryArchiveWorkerOutcomeDTO } from 'history-scanner-dto';
import type {
	HistoryArchiveObjectCompletionDTO,
	HistoryArchiveObjectFailureDTO,
	ScanCoordinatorService
} from '../../domain/scan/ScanCoordinatorService.js';
import type { HistoryArchiveObjectJobDelivery } from './HistoryArchiveObjectJobDelivery.js';
import {
	ArchiveObjectWorkerTelemetry,
	mapFailureToWorkerOutcome
} from './ArchiveObjectWorkerTelemetry.js';
import { retryArchiveObjectTerminalUpdate } from './ArchiveObjectTerminalUpdate.js';
import { logArchiveObjectFailure } from './ArchiveObjectFailureLogger.js';
import { archiveObjectTerminalDrainTimeoutMs } from './ArchiveObjectShutdown.js';

type Verification = Result<
	HistoryArchiveObjectCompletionDTO,
	HistoryArchiveObjectFailureDTO
>;
interface TerminalEntry {
	readonly delivery: HistoryArchiveObjectJobDelivery;
	readonly result: Verification;
	readonly done: Promise<void>;
	readonly resolve: () => void;
	cancelled: boolean;
	finalized: boolean;
	acknowledging?: Promise<void>;
}

/** RAM is not durable: the original broker message owns recovery until its ACK. */
export class ArchiveObjectTerminalQueue {
	private readonly entries = new Set<TerminalEntry>();
	private readonly claims = new Set<string>();
	private readonly waiting = new Set<() => void>();
	private flushPending: TerminalEntry[] = [];
	private batchInFlight = false;
	private flushScheduled = false;
	private closing: Promise<void> | null = null;
	private stopped = false;
	private completed = 0;
	private retried = 0;
	private batchRequests = 0;
	private batchItems = 0;
	private maxBatchSize = 0;

	constructor(
		private readonly capacity: number,
		private readonly coordinator: ScanCoordinatorService,
		private readonly telemetry: ArchiveObjectWorkerTelemetry,
		private readonly logger: Logger,
		private readonly onError: (error: Error) => void,
		private readonly checkIn: (status: 'ok' | 'error') => Promise<void>
	) {
		if (!Number.isSafeInteger(capacity) || capacity < 1)
			throw new Error('Invalid terminal capacity');
	}

	get metrics() {
		return {
			pending: this.entries.size,
			capacity: this.capacity,
			completed: this.completed,
			retried: this.retried,
			batchRequests: this.batchRequests,
			batchItems: this.batchItems,
			maxBatchSize: this.maxBatchSize
		};
	}

	/** Do not overwrite telemetry/lease ownership on an in-process redelivery. */
	claim(remoteId: string): boolean {
		if (this.stopped || this.claims.has(remoteId)) return false;
		this.claims.add(remoteId);
		return true;
	}

	releaseClaim(remoteId: string): void {
		this.claims.delete(remoteId);
	}

	async enqueue(
		delivery: HistoryArchiveObjectJobDelivery,
		result: Verification
	): Promise<void> {
		while (!this.stopped && this.entries.size >= this.capacity) {
			await new Promise<void>((resolve) => this.waiting.add(resolve));
		}
		if (this.stopped) throw new Error('Archive terminal queue is stopping');
		let resolve!: () => void;
		const done = new Promise<void>((settle) => {
			resolve = settle;
		});
		const entry: TerminalEntry = {
			delivery,
			result,
			done,
			resolve,
			cancelled: false,
			finalized: false
		};
		this.entries.add(entry);
		this.telemetry.detachSlot(delivery.job.remoteId);
		this.flushPending.push(entry);
		this.scheduleFlush();
	}

	async persistInline(
		delivery: HistoryArchiveObjectJobDelivery,
		result: Verification
	): Promise<void> {
		let outcome: HistoryArchiveWorkerOutcomeDTO = 'worker_issue';
		try {
			await retryArchiveObjectTerminalUpdate(
				() => this.writeSingle(delivery, result),
				this.onError
			);
			await delivery.acknowledge();
			outcome = this.outcome(result);
			await this.report(delivery, result);
		} finally {
			await this.telemetry.finishObject(delivery.job.remoteId, outcome);
			this.releaseClaim(delivery.job.remoteId);
		}
	}

	async drain(): Promise<void> {
		await Promise.all([...this.entries].map((entry) => entry.done));
	}

	close(): Promise<void> {
		if (this.closing !== null) return this.closing;
		this.stopped = true;
		this.wakeWaiters();
		this.closing = this.drainOrRelease();
		return this.closing;
	}

	private flush(): void {
		this.flushScheduled = false;
		const available = this.flushPending.filter((entry) => !entry.cancelled);
		const entries = available.filter(
			(entry) => entry.result.isErr() || !this.batchInFlight
		);
		this.flushPending = available.filter((entry) => !entries.includes(entry));
		const successes = entries.filter((entry) => entry.result.isOk());
		// One HTTP success batch in flight. Arrivals accumulate within the same W budget.
		this.batchInFlight ||= successes.length > 0;
		const batch =
			successes.length === 0
				? null
				: this.writeBatch(successes).finally(() => {
						this.batchInFlight = false;
						if (this.flushPending.length > 0) this.scheduleFlush();
					});
		for (const entry of entries) {
			const index = successes.indexOf(entry);
			const first =
				batch !== null && index >= 0
					? batch.then(
							(results) =>
								results[index] ??
								err(new Error('Missing terminal batch result'))
						)
					: this.writeSingle(entry.delivery, entry.result).catch(
							(error: unknown) => err(mapUnknownToError(error))
						);
			void this.persist(entry, first).catch(this.onError);
		}
	}

	private scheduleFlush(): void {
		if (this.flushScheduled) return;
		this.flushScheduled = true;
		queueMicrotask(() => this.flush());
	}

	private async writeBatch(
		entries: readonly TerminalEntry[]
	): Promise<readonly Result<void, Error>[]> {
		try {
			// Attempted batch traffic, not a claim that durable rows were written.
			this.batchRequests++;
			this.batchItems += entries.length;
			this.maxBatchSize = Math.max(this.maxBatchSize, entries.length);
			const result = await this.coordinator.completeHistoryArchiveObjects(
				entries.map((entry) => {
					if (entry.result.isErr())
						throw new Error('Failure passed to completion batch');
					return {
						remoteId: entry.delivery.job.remoteId,
						completion: {
							...entry.result.value,
							...this.fields(entry.delivery)
						}
					};
				})
			);
			return result.isOk()
				? result.value
				: entries.map(() => err(result.error));
		} catch (error) {
			return entries.map(() => err(mapUnknownToError(error)));
		}
	}

	private async persist(
		entry: TerminalEntry,
		first: Promise<Result<void, Error>>
	): Promise<void> {
		let outcome: HistoryArchiveWorkerOutcomeDTO = 'worker_issue';
		let initial = true;
		try {
			await retryArchiveObjectTerminalUpdate(() => {
				if (entry.cancelled)
					throw new Error('Terminal delivery released during shutdown');
				if (initial) {
					initial = false;
					return first;
				}
				return this.writeSingle(entry.delivery, entry.result);
			}, this.onError);
			if (entry.cancelled) return;
			entry.acknowledging = entry.delivery.acknowledge();
			await entry.acknowledging;
			outcome = this.outcome(entry.result);
			this.completed++;
			await this.report(entry.delivery, entry.result);
		} catch (error) {
			if (!entry.cancelled) {
				this.onError(mapUnknownToError(error));
				this.retried++;
				await entry.delivery.retry(30_000);
			}
		} finally {
			await this.finish(entry, outcome);
		}
	}

	private fields(delivery: HistoryArchiveObjectJobDelivery) {
		return {
			claimAttempt: delivery.job.claimAttempt,
			...(delivery.source === 'broker'
				? { executionId: delivery.executionId, scheduler: 'broker' as const }
				: { scheduler: 'legacy' as const })
		};
	}

	private writeSingle(
		delivery: HistoryArchiveObjectJobDelivery,
		result: Verification
	): Promise<Result<void, Error>> {
		return result.isOk()
			? this.coordinator.completeHistoryArchiveObject(delivery.job.remoteId, {
					...result.value,
					...this.fields(delivery)
				})
			: this.coordinator.failHistoryArchiveObject(delivery.job.remoteId, {
					...result.error,
					...this.fields(delivery)
				});
	}

	private outcome(result: Verification): HistoryArchiveWorkerOutcomeDTO {
		return result.isOk() ? 'verified' : mapFailureToWorkerOutcome(result.error);
	}

	private async report(
		delivery: HistoryArchiveObjectJobDelivery,
		result: Verification
	): Promise<void> {
		if (result.isErr())
			logArchiveObjectFailure(this.logger, delivery.job.remoteId, result.error);
		await this.checkIn(
			result.isErr() && result.error.failureChannel === 'scanner_issue'
				? 'error'
				: 'ok'
		);
	}

	private async finish(
		entry: TerminalEntry,
		outcome: HistoryArchiveWorkerOutcomeDTO
	): Promise<void> {
		if (entry.finalized) return;
		entry.finalized = true;
		try {
			await this.telemetry.finishObject(entry.delivery.job.remoteId, outcome);
		} finally {
			this.releaseClaim(entry.delivery.job.remoteId);
			this.entries.delete(entry);
			entry.resolve();
			this.wakeWaiters();
		}
	}

	private wakeWaiters(): void {
		for (const resolve of this.waiting) resolve();
		this.waiting.clear();
	}

	private async drainOrRelease(): Promise<void> {
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			await Promise.race([
				this.drain(),
				new Promise<void>((resolve) => {
					timer = setTimeout(resolve, archiveObjectTerminalDrainTimeoutMs);
				})
			]);
		} finally {
			if (timer !== undefined) clearTimeout(timer);
		}
		await Promise.all(
			[...this.entries].map(async (entry) => {
				entry.cancelled = true;
				try {
					await entry.acknowledging?.catch(() => undefined);
					await entry.delivery.release();
				} catch (error) {
					this.onError(mapUnknownToError(error));
				} finally {
					await this.finish(entry, 'released');
				}
			})
		);
		this.logger.info('Archive terminal queue drained', this.metrics);
	}
}
