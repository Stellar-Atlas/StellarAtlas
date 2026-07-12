import { mock, type MockProxy } from 'jest-mock-extended';
import { ok } from 'neverthrow';
import type { ExceptionLogger } from 'exception-logger';
import type { Logger } from 'logger';
import type {
	HistoryArchiveObjectJobDTO,
	ScanCoordinatorService
} from '../../../domain/scan/ScanCoordinatorService.js';
import {
	ArchiveObjectWorkerTelemetry,
	createHistoryArchiveWorkerProcessIdentity,
	mapFailureToWorkerOutcome
} from '../ArchiveObjectWorkerTelemetry.js';
import type { HistoryArchiveWorkerReportSink } from '../CoalescingHistoryArchiveWorkerReporter.js';

describe('ArchiveObjectWorkerTelemetry', () => {
	let scanCoordinator: MockProxy<ScanCoordinatorService>;
	let statusReporter: MockProxy<HistoryArchiveWorkerReportSink>;
	let telemetry: ArchiveObjectWorkerTelemetry;

	beforeEach(() => {
		scanCoordinator = mock<ScanCoordinatorService>();
		statusReporter = mock<HistoryArchiveWorkerReportSink>();
		scanCoordinator.touchHistoryArchiveObject.mockResolvedValue(ok(undefined));
		telemetry = new ArchiveObjectWorkerTelemetry(
			scanCoordinator,
			statusReporter,
			mock<ExceptionLogger>(),
			mock<Logger>(),
			{
				pid: 4123,
				processGeneration: 2,
				processId: '164f7788-9edb-4bb5-81c1-b928d85a21a5',
				processStartedAt: '2026-07-10T12:00:00.000Z',
				workerIdPrefix: 'object-host-4'
			},
			() => new Date('2026-07-10T12:05:00.000Z')
		);
	});

	it('coalesces object heartbeats and reports typed progress', async () => {
		let resolveTouch:
			((value: ReturnType<typeof ok<void, Error>>) => void) | undefined;
		scanCoordinator.touchHistoryArchiveObject.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					resolveTouch = resolve;
				})
		);
		await telemetry.startObject(0, createObjectJob());
		telemetry.updateProgress(
			'82a309de-a5df-457b-9412-f267ed5e7388',
			'downloading_bucket',
			2048
		);

		const first = telemetry.heartbeatObject(
			'82a309de-a5df-457b-9412-f267ed5e7388'
		);
		const second = telemetry.heartbeatObject(
			'82a309de-a5df-457b-9412-f267ed5e7388'
		);

		expect(scanCoordinator.touchHistoryArchiveObject).toHaveBeenCalledTimes(1);
		expect(statusReporter.enqueue).toHaveBeenLastCalledWith(
			expect.objectContaining({
				bytesDownloaded: 2048,
				claimAttempt: 3,
				stage: 'downloading_bucket',
				workerId: 'object-host-4-0'
			})
		);
		resolveTouch?.(ok(undefined));
		await Promise.all([first, second]);

		await telemetry.finishObject(
			'82a309de-a5df-457b-9412-f267ed5e7388',
			'verified'
		);
		expect(statusReporter.enqueue).toHaveBeenLastCalledWith(
			expect.objectContaining({
				currentObject: null,
				lastOutcome: 'verified',
				lastOutcomeAt: '2026-07-10T12:05:00.000Z',
				stage: 'idle'
			})
		);
	});

	it('builds a stable opaque worker slot identity', () => {
		const identity = createHistoryArchiveWorkerProcessIdentity(
			{
				HISTORY_OBJECT_WORKER_GENERATION: '3',
				HISTORY_OBJECT_WORKER_INDEX: '7'
			},
			'private-hostname',
			9001,
			new Date('2026-07-10T12:00:00.000Z'),
			'2c1e2d99-2025-4a04-bb28-647636f848a1'
		);

		expect(identity).toMatchObject({
			pid: 9001,
			processGeneration: 3,
			processId: '2c1e2d99-2025-4a04-bb28-647636f848a1',
			workerIdPrefix: expect.stringMatching(/^object-[0-9a-f]{10}-7$/)
		});
		expect(identity.workerIdPrefix).not.toContain('private-hostname');
	});

	it('writes the terminal idle row after an in-flight active heartbeat', async () => {
		let resolveTouch:
			((value: ReturnType<typeof ok<void, Error>>) => void) | undefined;
		scanCoordinator.touchHistoryArchiveObject.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					resolveTouch = resolve;
				})
		);
		await telemetry.startObject(0, createObjectJob());
		const heartbeat = telemetry.heartbeatObject(
			'82a309de-a5df-457b-9412-f267ed5e7388'
		);
		const finish = telemetry.finishObject(
			'82a309de-a5df-457b-9412-f267ed5e7388',
			'verified'
		);

		expect(statusReporter.enqueue).toHaveBeenLastCalledWith(
			expect.objectContaining({ currentObject: expect.any(Object) })
		);
		resolveTouch?.(ok(undefined));
		await Promise.all([heartbeat, finish]);

		expect(statusReporter.enqueue).toHaveBeenLastCalledWith(
			expect.objectContaining({
				currentObject: null,
				lastOutcome: 'verified',
				stage: 'idle'
			})
		);
	});

	it('reports a released outcome when shutdown returns a claim', async () => {
		scanCoordinator.releaseHistoryArchiveObject.mockResolvedValue(
			ok(undefined)
		);
		await telemetry.startObject(0, createObjectJob());

		await telemetry.releaseActiveObjectJobs();

		expect(scanCoordinator.releaseHistoryArchiveObject).toHaveBeenCalledWith(
			'82a309de-a5df-457b-9412-f267ed5e7388',
			3
		);
		expect(statusReporter.enqueue).toHaveBeenLastCalledWith(
			expect.objectContaining({
				currentObject: null,
				lastOutcome: 'released',
				stage: 'idle'
			})
		);
	});

	it('keeps worker issues separate from remote archive outcomes', () => {
		expect(
			mapFailureToWorkerOutcome({
				errorMessage: 'bad local URL',
				errorType: 'misleading_remote_name',
				failureChannel: 'scanner_issue'
			})
		).toBe('worker_issue');
		expect(
			mapFailureToWorkerOutcome({
				errorMessage: 'wrong hash',
				errorType: 'worker_error',
				failureChannel: 'archive_evidence'
			})
		).toBe('archive_error');
	});
});

function createObjectJob(): HistoryArchiveObjectJobDTO {
	return {
		archiveUrl: 'https://archive.example',
		bucketHash: 'a'.repeat(64),
		checkpointLedger: null,
		claimAttempt: 3,
		objectKey: `bucket:${'a'.repeat(64)}`,
		objectType: 'bucket',
		objectUrl: 'https://archive.example/bucket.xdr.gz',
		remoteId: '82a309de-a5df-457b-9412-f267ed5e7388'
	};
}
