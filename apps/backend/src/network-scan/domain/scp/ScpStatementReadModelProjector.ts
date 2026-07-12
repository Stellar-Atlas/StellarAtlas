import type { Logger } from '@core/services/Logger.js';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';
import type { ScpStatementObservation as CrawlerScpStatementObservation } from 'crawler';
import type { ScpStatementLiveStore } from './ScpStatementLiveStore.js';
import type { ScpStatementObservationRepository } from './ScpStatementObservationRepository.js';
import { settleWithin } from './ScpStatementAsyncDeadline.js';
import { ScpStatementCanonicalProjectionTail } from './ScpStatementCanonicalProjectionTail.js';
import { ScpStatementProjectionTaskReconciler } from './ScpStatementProjectionTaskReconciler.js';
import type {
	BackfillRequestOutcome,
	ProjectionDrainWaiter,
	ProjectionRequestOutcome,
	ProjectionWork,
	ScpStatementReadModelProjectorOptions
} from './ScpStatementReadModelProjectorTypes.js';
import {
	scpStatementObservationPolicy,
	selectNewestScpStatementObservations
} from './ScpStatementObservationPolicy.js';

export type { ScpStatementReadModelProjectorOptions } from './ScpStatementReadModelProjectorTypes.js';

export class ScpStatementReadModelProjector {
	private accepting = true;
	private active = false;
	private readonly backfillBatchSize: number;
	private backfillCursor = 0;
	private backfillRequired = false;
	private backfillRestartRequired = false;
	private readonly backfillTimeoutMs: number;
	private readonly backfillWindowMs: number;
	private readonly batchSize: number;
	private cooldownTimer: ReturnType<typeof setTimeout> | undefined;
	private cooldownUntilMs = 0;
	private readonly cooldownMs: number;
	private readonly canonicalTail: ScpStatementCanonicalProjectionTail;
	private readonly detachedRequests = new Set<Promise<unknown>>();
	private drainWaiters: ProjectionDrainWaiter[] = [];
	private readonly maxOutstandingRequests: number;
	private pending: CrawlerScpStatementObservation[] = [];
	private taskReconciliationDue = false;
	private readonly taskReconciliationIntervalMs: number;
	private taskReconciliationRequired = false;
	private readonly taskReconciler: ScpStatementProjectionTaskReconciler;
	private taskReconciliationTimer: ReturnType<typeof setTimeout> | undefined;
	private started = false;
	private stopped = false;
	private readonly timeoutMs: number;

	constructor(
		private readonly liveStore: ScpStatementLiveStore,
		private readonly repository: ScpStatementObservationRepository,
		private readonly logger: Logger,
		options: ScpStatementReadModelProjectorOptions = {}
	) {
		this.backfillBatchSize =
			options.backfillBatchSize ??
			scpStatementObservationPolicy.projectionBackfillBatchSize;
		this.backfillTimeoutMs =
			options.backfillTimeoutMs ??
			scpStatementObservationPolicy.projectionBackfillTimeoutMs;
		this.backfillWindowMs =
			options.backfillWindowMs ??
			scpStatementObservationPolicy.projectionBackfillWindowMs;
		this.batchSize =
			options.batchSize ?? scpStatementObservationPolicy.projectionBatchSize;
		this.cooldownMs =
			options.cooldownMs ?? scpStatementObservationPolicy.projectionCooldownMs;
		this.maxOutstandingRequests =
			options.maxOutstandingRequests ??
			scpStatementObservationPolicy.projectionMaxOutstandingRequests;
		this.taskReconciliationIntervalMs =
			options.taskReconciliationIntervalMs ??
			scpStatementObservationPolicy.projectionTaskReconciliationIntervalMs;
		this.timeoutMs =
			options.timeoutMs ?? scpStatementObservationPolicy.projectionTimeoutMs;
		this.taskReconciler = new ScpStatementProjectionTaskReconciler(
			this.liveStore,
			this.timeoutMs
		);
		this.canonicalTail = new ScpStatementCanonicalProjectionTail(
			this.repository,
			this.logger,
			(observations) => {
				if (this.stopped) return;
				this.queuePending(observations);
				this.pump();
			},
			() => this.pump(),
			{
				batchSize: options.tailBatchSize,
				cooldownMs: this.cooldownMs,
				maxOutstandingRequests: this.maxOutstandingRequests,
				pollIntervalMs: options.tailPollIntervalMs,
				timeoutMs: options.tailTimeoutMs
			}
		);
	}

	start(): void {
		if (this.started || this.stopped) return;
		this.started = true;
		this.canonicalTail.start();
		this.requestBackfill();
		this.pump();
	}

	enqueue(observations: readonly CrawlerScpStatementObservation[]): void {
		if (!this.accepting || this.stopped || observations.length === 0) return;
		this.queuePending(observations);
		this.pump();
	}

	async drain(timeoutMs: number): Promise<boolean> {
		this.accepting = false;
		this.canonicalTail.stop();
		this.clearCooldown();
		this.clearTaskReconciliationTimer();
		if (this.taskReconciliationRequired) this.taskReconciliationDue = true;
		this.cooldownUntilMs = 0;
		this.pump();
		if (this.isDrained) {
			this.stop();
			return true;
		}
		if (timeoutMs <= 0) {
			this.stop();
			return false;
		}

		return new Promise<boolean>((resolve) => {
			const waiter: ProjectionDrainWaiter = {
				resolve,
				timeout: setTimeout(() => {
					this.drainWaiters = this.drainWaiters.filter(
						(candidate) => candidate !== waiter
					);
					this.stop();
					resolve(false);
				}, timeoutMs)
			};
			this.drainWaiters.push(waiter);
		});
	}

	shutdown(): void {
		this.accepting = false;
		this.canonicalTail.stop();
		this.stop();
	}

	private pump(): void {
		this.finishDrainIfPossible();
		if (this.stopped || this.active) return;
		if (this.outstandingRequests >= this.maxOutstandingRequests) return;

		const cooldownRemainingMs = this.cooldownUntilMs - Date.now();
		if (cooldownRemainingMs > 0) {
			this.scheduleCooldown(cooldownRemainingMs);
			return;
		}

		if (this.taskReconciliationRequired && this.taskReconciliationDue) {
			this.startTaskReconciliation();
			return;
		}

		if (this.pending.length > 0) {
			const start = Math.max(0, this.pending.length - this.batchSize);
			const observations = this.pending.splice(start, this.batchSize);
			this.startProjection({ observations });
			return;
		}

		if (this.backfillRequired) this.loadBackfillPage();
	}

	private loadBackfillPage(): void {
		this.active = true;
		const request = this.repository
			.findProjectionPage({
				afterId: this.backfillCursor,
				limit: this.backfillBatchSize,
				observedAfter: new Date(Date.now() - this.backfillWindowMs)
			})
			.then(
				(page): BackfillRequestOutcome => ({ page, status: 'settled' }),
				(error: unknown): BackfillRequestOutcome => ({
					error: mapUnknownToError(error),
					status: 'failed'
				})
			);
		void settleWithin(request, this.backfillTimeoutMs).then((outcome) => {
			this.active = false;
			if (this.stopped) return;
			if (outcome === 'timed_out') {
				this.onBackgroundTimeout(request, 'PostgreSQL projection backfill');
				return;
			}
			if (outcome.status === 'failed') {
				this.deferAfterFailure(outcome.error, 0);
				return;
			}
			const { page } = outcome;
			if (page.observations.length === 0) {
				this.completeBackfill();
				this.pump();
				return;
			}
			if (
				page.nextAfterId !== null &&
				page.nextAfterId <= this.backfillCursor
			) {
				this.deferAfterFailure(
					new Error('SCP projection backfill cursor did not advance'),
					page.observations.length
				);
				return;
			}
			this.startProjection({
				backfillNextAfterId: page.nextAfterId,
				observations: page.observations
			});
		});
	}

	private startProjection(work: ProjectionWork): void {
		this.active = true;
		const request = Promise.resolve()
			.then(() => this.liveStore.saveMany(work.observations))
			.then(
				(result): ProjectionRequestOutcome => ({ result, status: 'settled' }),
				(error: unknown): ProjectionRequestOutcome => ({
					error: mapUnknownToError(error),
					status: 'failed'
				})
			);
		let timeout: ReturnType<typeof setTimeout> | undefined;
		const timedOut = new Promise<'timed_out'>((resolve) => {
			timeout = setTimeout(() => resolve('timed_out'), this.timeoutMs);
		});

		void Promise.race([request, timedOut]).then((outcome) => {
			if (timeout !== undefined) clearTimeout(timeout);
			this.active = false;
			if (this.stopped) return;

			if (outcome === 'timed_out') {
				this.onTimeout(request, work);
				return;
			}
			if (outcome.status === 'failed') {
				this.queueUnaccepted(work);
				this.deferAfterFailure(outcome.error, work.observations.length);
				return;
			}
			if (outcome.result.status === 'deferred') {
				this.queueUnaccepted(work);
				this.cooldownUntilMs =
					Date.now() + (outcome.result.retryAfterMs ?? this.cooldownMs);
				this.logger.warn('Live SCP read-model projection was deferred', {
					reason: outcome.result.reason,
					statements: work.observations.length
				});
				this.pump();
				return;
			}

			if (outcome.result.taskPending === true) {
				this.taskReconciliationRequired = true;
				this.scheduleTaskReconciliation(this.taskReconciliationIntervalMs);
			}
			this.acceptBackfillWork(work);
			this.pump();
		});
	}

	private onTimeout(
		request: Promise<ProjectionRequestOutcome>,
		work: ProjectionWork
	): void {
		this.queueUnaccepted(work);
		this.cooldownUntilMs = Date.now() + this.cooldownMs;
		this.detachedRequests.add(request);
		this.logger.warn('Live SCP read-model projection timed out', {
			cooldownMs: this.cooldownMs,
			outstandingRequests: this.outstandingRequests,
			statements: work.observations.length,
			timeoutMs: this.timeoutMs
		});

		void request.then(() => {
			this.detachedRequests.delete(request);
			this.pump();
		});
		this.pump();
	}

	private startTaskReconciliation(): void {
		this.active = true;
		this.taskReconciliationDue = false;
		const request = this.taskReconciler.start();
		void request.settlement.then((outcome) => {
			this.active = false;
			if (this.stopped) return;
			if (outcome === 'timed_out') {
				this.taskReconciliationDue = true;
				this.onBackgroundTimeout(
					request.completion,
					'Meilisearch task reconciliation'
				);
				return;
			}
			if (outcome.status === 'failed') {
				this.scheduleTaskReconciliation(this.taskReconciliationIntervalMs);
				this.deferAfterFailure(outcome.error, 0);
				return;
			}
			if (outcome.result.status === 'pending') {
				this.scheduleTaskReconciliation(outcome.result.retryAfterMs);
				this.pump();
				return;
			}
			if (outcome.result.status === 'failed') {
				this.taskReconciliationRequired = false;
				this.requestBackfill();
				this.cooldownUntilMs =
					Date.now() + (outcome.result.retryAfterMs ?? this.cooldownMs);
				this.logger.warn('Live SCP projection task failed after acceptance', {
					reason: outcome.result.reason
				});
				this.pump();
				return;
			}

			this.taskReconciliationRequired = false;
			this.pump();
		});
	}

	private onBackgroundTimeout(
		request: Promise<unknown>,
		operation: string
	): void {
		this.cooldownUntilMs = Date.now() + this.cooldownMs;
		this.detachedRequests.add(request);
		this.logger.warn(`${operation} timed out`, {
			cooldownMs: this.cooldownMs,
			outstandingRequests: this.outstandingRequests
		});
		void request.then(() => {
			this.detachedRequests.delete(request);
			this.pump();
		});
		this.pump();
	}

	private queueUnaccepted(work: ProjectionWork): void {
		this.queuePending(work.observations);
		if (work.backfillNextAfterId === undefined) this.requestBackfill();
	}

	private queuePending(
		observations: readonly CrawlerScpStatementObservation[]
	): void {
		const combined = [...this.pending, ...observations];
		if (
			new Set(combined.map(({ statementHash }) => statementHash)).size >
			scpStatementObservationPolicy.projectionMaxPendingObservations
		) {
			this.requestBackfill();
		}
		this.pending = selectNewestScpStatementObservations(combined);
	}

	private requestBackfill(): void {
		if (!this.backfillRequired) {
			this.backfillRequired = true;
			this.backfillCursor = 0;
			return;
		}
		if (this.backfillCursor > 0) this.backfillRestartRequired = true;
	}

	private acceptBackfillWork(work: ProjectionWork): void {
		if (work.backfillNextAfterId === undefined) return;
		if (work.backfillNextAfterId === null) {
			this.completeBackfill();
			return;
		}
		this.backfillCursor = work.backfillNextAfterId;
	}

	private completeBackfill(): void {
		if (this.backfillRestartRequired) {
			this.backfillRestartRequired = false;
			this.backfillCursor = 0;
			return;
		}
		this.backfillCursor = 0;
		this.backfillRequired = false;
	}

	private deferAfterFailure(error: Error, statements: number): void {
		this.cooldownUntilMs = Date.now() + this.cooldownMs;
		this.logger.warn('Could not project live SCP statements', {
			cooldownMs: this.cooldownMs,
			errorMessage: error.message,
			statements
		});
		this.pump();
	}

	private scheduleCooldown(delayMs: number): void {
		if (this.cooldownTimer !== undefined) return;
		this.cooldownTimer = setTimeout(() => {
			this.cooldownTimer = undefined;
			this.pump();
		}, delayMs);
	}

	private scheduleTaskReconciliation(delayMs: number): void {
		if (
			this.stopped ||
			this.taskReconciliationTimer !== undefined ||
			this.taskReconciliationDue
		) {
			return;
		}
		this.taskReconciliationTimer = setTimeout(
			() => {
				this.taskReconciliationTimer = undefined;
				this.taskReconciliationDue = true;
				this.pump();
			},
			Math.max(0, delayMs)
		);
	}

	private clearCooldown(): void {
		if (this.cooldownTimer === undefined) return;
		clearTimeout(this.cooldownTimer);
		this.cooldownTimer = undefined;
	}

	private clearTaskReconciliationTimer(): void {
		if (this.taskReconciliationTimer === undefined) return;
		clearTimeout(this.taskReconciliationTimer);
		this.taskReconciliationTimer = undefined;
	}

	private finishDrainIfPossible(): void {
		if (!this.isDrained || this.drainWaiters.length === 0) return;
		const waiters = this.drainWaiters.splice(0);
		this.stop();
		for (const waiter of waiters) {
			clearTimeout(waiter.timeout);
			waiter.resolve(true);
		}
	}

	private stop(): void {
		this.stopped = true;
		this.canonicalTail.stop();
		this.clearCooldown();
		this.clearTaskReconciliationTimer();
		this.pending = [];
		this.backfillRequired = false;
		this.backfillRestartRequired = false;
		this.taskReconciliationDue = false;
		this.taskReconciliationRequired = false;
	}

	private get isDrained(): boolean {
		return (
			!this.active &&
			this.canonicalTail.isDrained &&
			this.detachedRequests.size === 0 &&
			this.pending.length === 0 &&
			!this.backfillRequired &&
			!this.taskReconciliationRequired
		);
	}

	private get outstandingRequests(): number {
		return this.detachedRequests.size + (this.active ? 1 : 0);
	}
}
