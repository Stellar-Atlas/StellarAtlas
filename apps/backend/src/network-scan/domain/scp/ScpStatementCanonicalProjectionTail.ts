import type { Logger } from '@core/services/Logger.js';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';
import type { ScpStatementObservation as CrawlerScpStatementObservation } from 'crawler';
import { settleWithin } from './ScpStatementAsyncDeadline.js';
import type { ScpStatementObservationRepository } from './ScpStatementObservationRepository.js';
import { scpStatementObservationPolicy } from './ScpStatementObservationPolicy.js';

interface CanonicalProjectionTailOptions {
	batchSize?: number;
	cooldownMs?: number;
	maxOutstandingRequests?: number;
	pollIntervalMs?: number;
	timeoutMs?: number;
}

type TailRequestOutcome =
	| { error: Error; status: 'failed' }
	| {
			page: Awaited<
				ReturnType<ScpStatementObservationRepository['findProjectionEventPage']>
			>;
			status: 'settled';
	  };

export class ScpStatementCanonicalProjectionTail {
	private active = false;
	private readonly batchSize: number;
	private readonly cooldownMs: number;
	private cursor = 0;
	private readonly detachedRequests = new Set<Promise<TailRequestOutcome>>();
	private readonly maxOutstandingRequests: number;
	private readonly pollIntervalMs: number;
	private stopped = false;
	private timer: ReturnType<typeof setTimeout> | undefined;
	private readonly timeoutMs: number;

	constructor(
		private readonly repository: ScpStatementObservationRepository,
		private readonly logger: Logger,
		private readonly enqueue: (
			observations: readonly CrawlerScpStatementObservation[]
		) => void,
		private readonly onStateChange: () => void,
		options: CanonicalProjectionTailOptions = {}
	) {
		this.batchSize =
			options.batchSize ??
			scpStatementObservationPolicy.projectionEventTailBatchSize;
		this.cooldownMs =
			options.cooldownMs ?? scpStatementObservationPolicy.projectionCooldownMs;
		this.maxOutstandingRequests =
			options.maxOutstandingRequests ??
			scpStatementObservationPolicy.projectionMaxOutstandingRequests;
		this.pollIntervalMs =
			options.pollIntervalMs ??
			scpStatementObservationPolicy.projectionEventTailPollIntervalMs;
		this.timeoutMs =
			options.timeoutMs ??
			scpStatementObservationPolicy.projectionEventTailTimeoutMs;
	}

	start(): void {
		if (this.stopped) return;
		this.poll();
	}

	stop(): void {
		if (this.stopped) return;
		this.stopped = true;
		this.clearTimer();
		this.onStateChange();
	}

	get isDrained(): boolean {
		return !this.active && this.detachedRequests.size === 0;
	}

	private poll(): void {
		if (
			this.stopped ||
			this.active ||
			this.outstandingRequests >= this.maxOutstandingRequests
		) {
			return;
		}
		this.active = true;
		const request = Promise.resolve()
			.then(() =>
				this.repository.findProjectionEventPage({
					afterId: this.cursor,
					limit: this.batchSize
				})
			)
			.then(
				(page): TailRequestOutcome => ({ page, status: 'settled' }),
				(error: unknown): TailRequestOutcome => ({
					error: mapUnknownToError(error),
					status: 'failed'
				})
			);

		void settleWithin(request, this.timeoutMs).then((outcome) => {
			this.active = false;
			if (outcome === 'timed_out') {
				this.handleTimeout(request);
				return;
			}
			this.handleOutcome(outcome);
		});
	}

	private handleTimeout(request: Promise<TailRequestOutcome>): void {
		this.detachedRequests.add(request);
		this.logger.warn('PostgreSQL SCP projection tail timed out', {
			outstandingRequests: this.outstandingRequests,
			timeoutMs: this.timeoutMs
		});
		void request.then((outcome) => {
			this.detachedRequests.delete(request);
			this.handleOutcome(outcome);
		});
		this.schedule(this.cooldownMs);
		this.onStateChange();
	}

	private handleOutcome(outcome: TailRequestOutcome): void {
		if (outcome.status === 'failed') {
			this.logger.warn('Could not tail canonical SCP projection events', {
				errorMessage: outcome.error.message
			});
			this.schedule(this.cooldownMs);
			this.onStateChange();
			return;
		}
		const { page } = outcome;
		if (page.nextAfterId < this.cursor) {
			this.schedule(this.pollIntervalMs);
			this.onStateChange();
			return;
		}
		if (page.hasMore && page.nextAfterId === this.cursor) {
			this.logger.warn('SCP projection event cursor did not advance', {
				cursor: this.cursor
			});
			this.schedule(this.cooldownMs);
			this.onStateChange();
			return;
		}
		this.cursor = page.nextAfterId;
		if (page.observations.length > 0) this.enqueue(page.observations);
		this.schedule(page.hasMore ? 0 : this.pollIntervalMs);
		this.onStateChange();
	}

	private schedule(delayMs: number): void {
		if (this.stopped || this.timer !== undefined) return;
		this.timer = setTimeout(
			() => {
				this.timer = undefined;
				this.poll();
			},
			Math.max(0, delayMs)
		);
		this.timer.unref();
	}

	private clearTimer(): void {
		if (this.timer === undefined) return;
		clearTimeout(this.timer);
		this.timer = undefined;
	}

	private get outstandingRequests(): number {
		return this.detachedRequests.size + (this.active ? 1 : 0);
	}
}
