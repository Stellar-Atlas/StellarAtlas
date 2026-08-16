import type { ExceptionLogger } from 'exception-logger';
import type { HistoryArchiveWorkerReportDTO } from 'history-scanner-dto';
import { mapUnknownToError } from 'shared';
import type { HistoryArchiveWorkerStatusReporter } from '../../domain/scan/HistoryArchiveWorkerStatusReporter.js';

export interface HistoryArchiveWorkerReportSink {
	enqueue(report: HistoryArchiveWorkerReportDTO): void;
	flush(): Promise<void>;
}

const initialRetryDelayMs = 2_000;
const maximumRetryDelayMs = 30_000;
const retryJitterRatio = 0.25;

export class CoalescingHistoryArchiveWorkerReporter implements HistoryArchiveWorkerReportSink {
	private consecutiveFailures = 0;
	private inFlight = false;
	private readonly flushWaiters: Array<() => void> = [];
	private readonly pending = new Map<string, HistoryArchiveWorkerReportDTO>();
	private retryTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(
		private readonly reporter: HistoryArchiveWorkerStatusReporter,
		private readonly exceptionLogger: ExceptionLogger,
		private readonly maximumPendingWorkers: number,
		private readonly random: () => number = Math.random
	) {
		if (
			!Number.isSafeInteger(maximumPendingWorkers) ||
			maximumPendingWorkers < 1
		) {
			throw new Error('maximumPendingWorkers must be a positive integer');
		}
	}

	enqueue(report: HistoryArchiveWorkerReportDTO): void {
		this.setPending(report);
		this.pump();
	}

	async flush(): Promise<void> {
		if (
			!this.inFlight &&
			(this.pending.size === 0 || this.retryTimer !== null)
		) {
			return;
		}
		await new Promise<void>((resolve) => this.flushWaiters.push(resolve));
	}

	private pump(): void {
		if (this.inFlight) return;
		if (this.retryTimer !== null) {
			this.resolveFlushWaiters();
			return;
		}
		const next = this.pending.entries().next().value as
			[string, HistoryArchiveWorkerReportDTO] | undefined;
		if (next === undefined) {
			this.resolveFlushWaiters();
			return;
		}

		const [workerId, report] = next;
		this.pending.delete(workerId);
		this.inFlight = true;
		void Promise.resolve()
			.then(() => this.reporter.report(report))
			.then((result) => {
				if (result.isErr()) {
					this.handleFailure(report, result.error);
					return;
				}
				this.consecutiveFailures = 0;
			})
			.catch((error: unknown) => {
				this.handleFailure(report, mapUnknownToError(error));
			})
			.finally(() => {
				this.inFlight = false;
				this.pump();
			});
	}

	private handleFailure(
		report: HistoryArchiveWorkerReportDTO,
		error: Error
	): void {
		if (!this.pending.has(report.workerId)) this.setPending(report);
		this.consecutiveFailures += 1;
		const retryDelayMs = this.calculateRetryDelayMs();
		this.retryTimer = setTimeout(() => {
			this.retryTimer = null;
			this.pump();
		}, retryDelayMs);
		this.retryTimer.unref();
		this.exceptionLogger.captureException(error, {
			consecutiveFailures: this.consecutiveFailures,
			retryDelayMs
		});
	}

	private calculateRetryDelayMs(): number {
		const exponentialDelayMs = Math.min(
			maximumRetryDelayMs,
			initialRetryDelayMs * 2 ** Math.min(this.consecutiveFailures - 1, 30)
		);
		const random = Math.min(Math.max(this.random(), 0), 1);
		const jitterMultiplier =
			1 - retryJitterRatio + random * retryJitterRatio * 2;
		return Math.min(
			maximumRetryDelayMs,
			Math.max(
				initialRetryDelayMs,
				Math.round(exponentialDelayMs * jitterMultiplier)
			)
		);
	}

	private setPending(report: HistoryArchiveWorkerReportDTO): void {
		if (this.pending.has(report.workerId)) {
			this.pending.delete(report.workerId);
		} else if (this.pending.size >= this.maximumPendingWorkers) {
			const oldestWorkerId = this.pending.keys().next().value as
				string | undefined;
			if (oldestWorkerId !== undefined) this.pending.delete(oldestWorkerId);
		}

		this.pending.set(report.workerId, report);
	}

	private resolveFlushWaiters(): void {
		if (
			this.inFlight ||
			(this.pending.size > 0 && this.retryTimer === null)
		) {
			return;
		}
		for (const resolve of this.flushWaiters.splice(0)) resolve();
	}
}
