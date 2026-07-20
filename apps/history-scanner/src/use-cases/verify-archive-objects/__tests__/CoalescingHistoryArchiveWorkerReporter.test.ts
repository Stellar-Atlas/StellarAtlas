import type { ExceptionLogger } from 'exception-logger';
import type { HistoryArchiveWorkerReportDTO } from 'history-scanner-dto';
import { mock } from 'jest-mock-extended';
import { ok, type Result } from 'neverthrow';
import type { HistoryArchiveWorkerStatusReporter } from '../../../domain/scan/HistoryArchiveWorkerStatusReporter.js';
import { CoalescingHistoryArchiveWorkerReporter } from '../CoalescingHistoryArchiveWorkerReporter.js';

describe('CoalescingHistoryArchiveWorkerReporter', () => {
	it('keeps one request in flight and coalesces heartbeats to the latest row', async () => {
		const reporter = mock<HistoryArchiveWorkerStatusReporter>();
		const resolvers: Array<(result: Result<void, Error>) => void> = [];
		reporter.report.mockImplementation(
			() =>
				new Promise((resolve) => {
					resolvers.push(resolve);
				})
		);
		const coalescing = new CoalescingHistoryArchiveWorkerReporter(
			reporter,
			mock<ExceptionLogger>(),
			24
		);

		coalescing.enqueue(createReport('worker-1', 1));
		await flushPromises();
		for (let sequence = 2; sequence <= 100; sequence++) {
			coalescing.enqueue(createReport('worker-1', sequence));
		}

		expect(reporter.report).toHaveBeenCalledTimes(1);
		resolvers[0]?.(ok(undefined));
		await flushPromises();
		expect(reporter.report).toHaveBeenCalledTimes(2);
		expect(reporter.report).toHaveBeenLastCalledWith(
			expect.objectContaining({ sequence: 100 })
		);
		resolvers[1]?.(ok(undefined));
		await flushPromises();
	});

	it('drops the oldest pending worker when the bounded queue is full', async () => {
		const reporter = mock<HistoryArchiveWorkerStatusReporter>();
		const resolvers: Array<(result: Result<void, Error>) => void> = [];
		reporter.report.mockImplementation(
			() =>
				new Promise((resolve) => {
					resolvers.push(resolve);
				})
		);
		const coalescing = new CoalescingHistoryArchiveWorkerReporter(
			reporter,
			mock<ExceptionLogger>(),
			2
		);

		coalescing.enqueue(createReport('worker-0', 1));
		await flushPromises();
		coalescing.enqueue(createReport('worker-1', 1));
		coalescing.enqueue(createReport('worker-2', 1));
		coalescing.enqueue(createReport('worker-3', 1));
		resolvers[0]?.(ok(undefined));
		await flushPromises();

		expect(reporter.report).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ workerId: 'worker-2' })
		);
		resolvers[1]?.(ok(undefined));
		await flushPromises();
		expect(reporter.report).toHaveBeenNthCalledWith(
			3,
			expect.objectContaining({ workerId: 'worker-3' })
		);
		resolvers[2]?.(ok(undefined));
		await flushPromises();
	});
});

function createReport(
	workerId: string,
	sequence: number
): HistoryArchiveWorkerReportDTO {
	return {
		bytesDownloaded: null,
		claimAttempt: null,
		currentObject: null,
		lastOutcome: 'none',
		lastOutcomeAt: null,
		pid: 123,
		processGeneration: 0,
		processId: '164f7788-9edb-4bb5-81c1-b928d85a21a5',
		processStartedAt: '2026-07-10T12:00:00.000Z',
		sequence,
		slotIndex: 0,
		stage: 'idle',
		workerId
	};
}

async function flushPromises(): Promise<void> {
	await new Promise<void>((resolve) => setImmediate(resolve));
}
