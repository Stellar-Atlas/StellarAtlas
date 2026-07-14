import 'reflect-metadata';
import { Readable } from 'node:stream';
import { mock, type MockProxy } from 'jest-mock-extended';
import { err, ok } from 'neverthrow';
import type { ExceptionLogger } from 'exception-logger';
import type { HttpService } from 'http-helper';
import type { JobMonitor } from 'job-monitor';
import type { Logger } from 'logger';
import type { HistoryArchiveWorkerStatusReporter } from '../../../domain/scan/HistoryArchiveWorkerStatusReporter.js';
import type {
	HistoryArchiveObjectJobDTO,
	ScanCoordinatorService
} from '../../../domain/scan/ScanCoordinatorService.js';
import {
	BucketCache,
	BucketCacheFailure
} from '../../../domain/scanner/BucketCache.js';
import { HistoryArchiveStateValidator } from '../../../domain/history-archive/HistoryArchiveStateValidator.js';
import { VerifyArchiveObjects } from '../VerifyArchiveObjects.js';

type TestableVerifyArchiveObjects = VerifyArchiveObjects & {
	verifyObject(job: HistoryArchiveObjectJobDTO): Promise<void>;
};

describe('VerifyArchiveObjects', () => {
	let bucketCache: MockProxy<BucketCache>;
	let httpService: MockProxy<HttpService>;
	let scanCoordinator: MockProxy<ScanCoordinatorService>;
	let statusReporter: MockProxy<HistoryArchiveWorkerStatusReporter>;
	let verifier: TestableVerifyArchiveObjects;

	beforeEach(() => {
		bucketCache = mock<BucketCache>();
		httpService = mock<HttpService>();
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
			httpService,
			mock<HistoryArchiveStateValidator>(),
			bucketCache,
			mock<ExceptionLogger>(),
			jobMonitor,
			1,
			1,
			mock<Logger>()
		) as unknown as TestableVerifyArchiveObjects;
	});

	it('reports a response-stream abort as transport evidence', async () => {
		httpService.get.mockResolvedValue(
			ok({
				data: Readable.from(Buffer.from('partial bucket')),
				headers: {},
				status: 200,
				statusText: 'OK'
			})
		);
		bucketCache.verifyAndStore.mockResolvedValue(
			err(new BucketCacheFailure('source-stream', new Error('aborted')))
		);

		await verifier.verifyObject(
			createObjectJob({
				bucketHash:
					'4eae73efaa0ce061441dfe43ffc61c0ed24fcbc59e5ee512d1b60e8da2509655',
				objectKey:
					'bucket:4eae73efaa0ce061441dfe43ffc61c0ed24fcbc59e5ee512d1b60e8da2509655',
				objectType: 'bucket',
				objectUrl:
					'https://archive.example/bucket/4e/ae/73/bucket-4eae73efaa0ce061441dfe43ffc61c0ed24fcbc59e5ee512d1b60e8da2509655.xdr.gz'
			})
		);
		await flushPromises();

		expect(scanCoordinator.failHistoryArchiveObject).toHaveBeenCalledWith(
			'object-1',
			expect.objectContaining({
				errorMessage: 'aborted',
				errorType: 'archive_transport_error',
				failureChannel: 'archive_evidence',
				httpStatus: 200
			})
		);
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
