import type { ExceptionLogger } from 'exception-logger';
import type { HistoryArchiveWorkerReportDTO } from 'history-scanner-dto';
import { mapUnknownToError } from 'shared';
import type { HistoryArchiveWorkerStatusReporter } from '../../domain/scan/HistoryArchiveWorkerStatusReporter.js';

export interface HistoryArchiveWorkerReportSink {
	enqueue(report: HistoryArchiveWorkerReportDTO): void;
}

export class CoalescingHistoryArchiveWorkerReporter implements HistoryArchiveWorkerReportSink {
	private inFlight = false;
	private readonly pending = new Map<string, HistoryArchiveWorkerReportDTO>();

	constructor(
		private readonly reporter: HistoryArchiveWorkerStatusReporter,
		private readonly exceptionLogger: ExceptionLogger,
		private readonly maximumPendingWorkers: number
	) {
		if (
			!Number.isSafeInteger(maximumPendingWorkers) ||
			maximumPendingWorkers < 1
		) {
			throw new Error('maximumPendingWorkers must be a positive integer');
		}
	}

	enqueue(report: HistoryArchiveWorkerReportDTO): void {
		if (this.pending.has(report.workerId)) {
			this.pending.delete(report.workerId);
		} else if (this.pending.size >= this.maximumPendingWorkers) {
			const oldestWorkerId = this.pending.keys().next().value as
				string | undefined;
			if (oldestWorkerId !== undefined) this.pending.delete(oldestWorkerId);
		}

		this.pending.set(report.workerId, report);
		this.pump();
	}

	private pump(): void {
		if (this.inFlight) return;
		const next = this.pending.entries().next().value as
			[string, HistoryArchiveWorkerReportDTO] | undefined;
		if (next === undefined) return;

		const [workerId, report] = next;
		this.pending.delete(workerId);
		this.inFlight = true;
		void Promise.resolve()
			.then(() => this.reporter.report(report))
			.then((result) => {
				if (result.isErr()) this.exceptionLogger.captureException(result.error);
			})
			.catch((error: unknown) => {
				this.exceptionLogger.captureException(mapUnknownToError(error));
			})
			.finally(() => {
				this.inFlight = false;
				this.pump();
			});
	}
}
