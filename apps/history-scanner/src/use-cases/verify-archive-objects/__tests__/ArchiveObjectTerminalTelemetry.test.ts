import { mock } from 'jest-mock-extended';
import type { ExceptionLogger } from 'exception-logger';
import type { Logger } from 'logger';
import type { HistoryArchiveObjectJobDTO } from '../../../domain/scan/ScanCoordinatorService.js';
import type { HistoryArchiveWorkerReportSink } from '../CoalescingHistoryArchiveWorkerReporter.js';
import type { HistoryArchiveObjectJobLease } from '../HistoryArchiveObjectJobDelivery.js';
import { ArchiveObjectWorkerTelemetry } from '../ArchiveObjectWorkerTelemetry.js';

function job(remoteId: string): HistoryArchiveObjectJobDTO {
	return {
		remoteId,
		archiveUrl: 'https://archive/',
		objectUrl: `https://archive/${remoteId}`,
		objectKey: remoteId,
		objectType: 'ledger',
		checkpointLedger: 63,
		bucketHash: null,
		claimAttempt: 1
	};
}
describe('terminal delivery telemetry ownership', () => {
	beforeEach(() => jest.useFakeTimers());
	afterEach(() => jest.useRealTimers());
	it('keeps detached delivery heartbeat alive without reporting over the reused slot', async () => {
		const reports = mock<HistoryArchiveWorkerReportSink>();
		const telemetry = new ArchiveObjectWorkerTelemetry(
			reports,
			mock<ExceptionLogger>(),
			mock<Logger>()
		);
		const first = mock<HistoryArchiveObjectJobLease>(),
			second = mock<HistoryArchiveObjectJobLease>();
		telemetry.startObject(0, job('first'), first);
		telemetry.detachSlot('first');
		telemetry.startObject(0, job('second'), second);
		reports.enqueue.mockClear();
		await telemetry.heartbeatObject('first');
		telemetry.updateProgress('first', 'recording_archive_evidence', 123, null);
		expect(first.heartbeat).toHaveBeenCalledTimes(1);
		expect(reports.enqueue).not.toHaveBeenCalled();
		await telemetry.finishObject('first', 'verified');
		expect(reports.enqueue).not.toHaveBeenCalled();
		await telemetry.heartbeatObject('second');
		expect(reports.enqueue.mock.calls.at(-1)?.[0].currentObject?.remoteId).toBe(
			'second'
		);
		await telemetry.finishObject('second', 'verified');
		expect(reports.enqueue.mock.calls.at(-1)?.[0].stage).toBe('idle');
	});
	it('timer renews both verification and detached persistence leases', async () => {
		const telemetry = new ArchiveObjectWorkerTelemetry(
			mock<HistoryArchiveWorkerReportSink>(),
			mock<ExceptionLogger>(),
			mock<Logger>()
		);
		const first = mock<HistoryArchiveObjectJobLease>(),
			second = mock<HistoryArchiveObjectJobLease>();
		telemetry.startObject(0, job('first'), first);
		telemetry.detachSlot('first');
		telemetry.startObject(0, job('second'), second);
		await jest.advanceTimersByTimeAsync(32_000);
		expect(first.heartbeat).toHaveBeenCalledTimes(1);
		expect(second.heartbeat).toHaveBeenCalledTimes(1);
		await telemetry.releaseActiveObjectJobs();
		expect(first.release).toHaveBeenCalledTimes(1);
		expect(second.release).toHaveBeenCalledTimes(1);
		await jest.advanceTimersByTimeAsync(60_000);
		expect(first.heartbeat).toHaveBeenCalledTimes(1);
	});
	it('an old in-flight heartbeat cannot emit idle after another owner starts', async () => {
		const reports = mock<HistoryArchiveWorkerReportSink>();
		const telemetry = new ArchiveObjectWorkerTelemetry(
			reports,
			mock<ExceptionLogger>(),
			mock<Logger>()
		);
		const first = mock<HistoryArchiveObjectJobLease>();
		let release!: () => void;
		first.heartbeat.mockReturnValue(
			new Promise<void>((resolve) => {
				release = resolve;
			})
		);
		telemetry.startObject(0, job('first'), first);
		const beat = telemetry.heartbeatObject('first');
		const finish = telemetry.finishObject('first', 'verified');
		telemetry.startObject(
			0,
			job('second'),
			mock<HistoryArchiveObjectJobLease>()
		);
		reports.enqueue.mockClear();
		release();
		await Promise.all([beat, finish]);
		expect(reports.enqueue).not.toHaveBeenCalled();
		await telemetry.releaseActiveObjectJobs();
	});
});
