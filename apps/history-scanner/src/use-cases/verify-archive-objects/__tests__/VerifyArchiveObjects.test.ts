import 'reflect-metadata';
import { mock, type MockProxy } from 'jest-mock-extended';
import { ok } from 'neverthrow';
import type { ExceptionLogger } from 'exception-logger';
import type { HttpService } from 'http-helper';
import type { JobMonitor } from 'job-monitor';
import type { Logger } from 'logger';
import type { HistoryArchiveWorkerStatusReporter } from '../../../domain/scan/HistoryArchiveWorkerStatusReporter.js';
import type {
	HistoryArchiveObjectJobDTO,
	ScanCoordinatorService
} from '../../../domain/scan/ScanCoordinatorService.js';
import { BucketCache } from '../../../domain/scanner/BucketCache.js';
import { HistoryArchiveStateValidator } from '../../../domain/history-archive/HistoryArchiveStateValidator.js';
import { VerifyArchiveObjects } from '../VerifyArchiveObjects.js';

type TestableVerifyArchiveObjects = VerifyArchiveObjects & {
	verifyObject(job: HistoryArchiveObjectJobDTO): Promise<void>;
};

describe('VerifyArchiveObjects', () => {
	let scanCoordinator: MockProxy<ScanCoordinatorService>;
	let statusReporter: MockProxy<HistoryArchiveWorkerStatusReporter>;
	let verifier: TestableVerifyArchiveObjects;

	beforeEach(() => {
		scanCoordinator = mock<ScanCoordinatorService>();
		scanCoordinator.touchHistoryArchiveObject.mockResolvedValue(ok(undefined));
		scanCoordinator.failHistoryArchiveObject.mockResolvedValue(ok(undefined));
		scanCoordinator.completeHistoryArchiveObject.mockResolvedValue(
			ok(undefined)
		);
		statusReporter = mock<HistoryArchiveWorkerStatusReporter>();
		statusReporter.report.mockResolvedValue(ok(undefined));

		const jobMonitor = mock<JobMonitor>();
		jobMonitor.checkIn.mockResolvedValue(ok(undefined));

		verifier = new VerifyArchiveObjects(
			scanCoordinator,
			statusReporter,
			mock<HttpService>(),
			mock<HistoryArchiveStateValidator>(),
			mock<BucketCache>(),
			mock<ExceptionLogger>(),
			jobMonitor,
			1,
			1,
			mock<Logger>()
		) as unknown as TestableVerifyArchiveObjects;
	});

	it('reports a worker outcome without sending a redundant object heartbeat', async () => {
		await verifier.verifyObject(
			createObjectJob({ objectType: 'bucket', bucketHash: null })
		);
		await flushPromises();

		expect(scanCoordinator.touchHistoryArchiveObject).not.toHaveBeenCalled();
		expect(scanCoordinator.failHistoryArchiveObject).toHaveBeenCalledWith(
			'object-1',
			expect.objectContaining({
				claimAttempt: 3,
				failureChannel: 'scanner_issue'
			})
		);
		expect(statusReporter.report).toHaveBeenLastCalledWith(
			expect.objectContaining({
				currentObject: null,
				lastOutcome: 'worker_issue',
				stage: 'idle'
			})
		);
	});

	it('finishes archive work while the status API request is unresolved', async () => {
		statusReporter.report.mockImplementation(
			() => new Promise(() => undefined)
		);

		const result = await Promise.race([
			verifier
				.verifyObject(
					createObjectJob({ objectType: 'bucket', bucketHash: null })
				)
				.then(() => 'completed' as const),
			new Promise<'timed-out'>((resolve) =>
				setTimeout(() => resolve('timed-out'), 100)
			)
		]);

		expect(result).toBe('completed');
		expect(scanCoordinator.failHistoryArchiveObject).toHaveBeenCalledTimes(1);
		expect(statusReporter.report).toHaveBeenCalledTimes(1);
	});
});

function createObjectJob(
	overrides: Partial<HistoryArchiveObjectJobDTO> = {}
): HistoryArchiveObjectJobDTO {
	return {
		archiveUrl: 'https://archive.example',
		bucketHash: null,
		checkpointLedger: null,
		claimAttempt: 3,
		objectKey: 'unsupported:test',
		objectType: 'unsupported',
		objectUrl: 'https://archive.example/object',
		remoteId: 'object-1',
		...overrides
	};
}

async function flushPromises(): Promise<void> {
	await new Promise<void>((resolve) => setImmediate(resolve));
}
