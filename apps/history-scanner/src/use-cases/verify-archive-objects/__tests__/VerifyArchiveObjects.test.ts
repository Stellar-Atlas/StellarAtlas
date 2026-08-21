import 'reflect-metadata';
import { Readable } from 'node:stream';
import { mock, type MockProxy } from 'jest-mock-extended';
import { err, ok } from 'neverthrow';
import type { ExceptionLogger } from 'exception-logger';
import type { HttpService } from 'http-helper';
import type { JobMonitor } from 'job-monitor';
import type { Logger } from 'logger';
import type { HistoryArchiveDownloadPermit } from '../../../infrastructure/services/HistoryArchiveDownloadPermit.js';
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
import type {
	HistoryArchiveObjectJobDelivery,
	HistoryArchiveObjectJobSource
} from '../HistoryArchiveObjectJobDelivery.js';
import { VerifyArchiveObjects } from '../VerifyArchiveObjects.js';

type TestableVerifyArchiveObjects = {
	claimAndVerifyObject(slot: number): Promise<void>;
	downloadPermit: HistoryArchiveDownloadPermit;
	workerTelemetry: {
		startObject(slot: number, job: HistoryArchiveObjectJobDTO): void;
	};
	verifyObject(
		job: HistoryArchiveObjectJobDTO,
		releaseDownloadPermit: () => void,
		delivery: HistoryArchiveObjectJobDelivery
	): Promise<void>;
};

describe('VerifyArchiveObjects', () => {
	let bucketCache: MockProxy<BucketCache>;
	let httpService: MockProxy<HttpService>;
	let jobSource: MockProxy<HistoryArchiveObjectJobSource>;
	let scanCoordinator: MockProxy<ScanCoordinatorService>;
	let statusReporter: MockProxy<HistoryArchiveWorkerStatusReporter>;
	let verifier: TestableVerifyArchiveObjects;

	beforeEach(() => {
		bucketCache = mock<BucketCache>();
		httpService = mock<HttpService>();
		jobSource = mock<HistoryArchiveObjectJobSource>({ kind: 'legacy-http' });
		jobSource.close.mockResolvedValue(undefined);
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
			jobSource,
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

	it('releases the download permit when the coordinator claim rejects', async () => {
		const downloadPermit = mock<HistoryArchiveDownloadPermit>();
		const releasePermit = jest.fn();
		downloadPermit.acquire.mockResolvedValue(releasePermit);
		verifier.downloadPermit = downloadPermit;
		jobSource.next.mockRejectedValue(
			new Error('coordinator unavailable')
		);

		await expect(verifier.claimAndVerifyObject(0)).rejects.toThrow(
			'coordinator unavailable'
		);

		expect(releasePermit).toHaveBeenCalledTimes(1);
		expect(scanCoordinator.completeHistoryArchiveObject).not.toHaveBeenCalled();
		expect(scanCoordinator.failHistoryArchiveObject).not.toHaveBeenCalled();
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

		const job = createObjectJob({
				bucketHash:
					'4eae73efaa0ce061441dfe43ffc61c0ed24fcbc59e5ee512d1b60e8da2509655',
				objectKey:
					'bucket:4eae73efaa0ce061441dfe43ffc61c0ed24fcbc59e5ee512d1b60e8da2509655',
				objectType: 'bucket',
				objectUrl:
					'https://archive.example/bucket/4e/ae/73/bucket-4eae73efaa0ce061441dfe43ffc61c0ed24fcbc59e5ee512d1b60e8da2509655.xdr.gz'
			});
		const delivery = createObjectDelivery(job, 'broker');

		await verifier.verifyObject(job, () => undefined, delivery);
		await flushPromises();

		expect(scanCoordinator.failHistoryArchiveObject).toHaveBeenCalledWith(
			'object-1',
			expect.objectContaining({
				errorMessage: 'aborted',
				errorType: 'archive_transport_error',
				failureChannel: 'archive_availability',
				httpStatus: 200,
				executionId: 'execution-1',
				scheduler: 'broker'
			})
		);
		expect(delivery.acknowledge).toHaveBeenCalledTimes(1);
		expect(delivery.retry).not.toHaveBeenCalled();
	});

	it('reports a worker outcome without sending a redundant object heartbeat', async () => {
		const job = createObjectJob({ objectType: 'bucket', bucketHash: null });
		verifier.workerTelemetry.startObject(0, job);
		await verifier.verifyObject(
			job,
			() => undefined,
			createObjectDelivery(job)
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
                const legacyFailure =
                        scanCoordinator.failHistoryArchiveObject.mock.calls[0]?.[1];
                expect(legacyFailure).toEqual(
                        expect.objectContaining({ scheduler: 'legacy' })
                );
                expect(legacyFailure).not.toHaveProperty('executionId');
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
		const job = createObjectJob({ objectType: 'bucket', bucketHash: null });
		verifier.workerTelemetry.startObject(0, job);

		const result = await Promise.race([
			verifier
				.verifyObject(
					job,
					() => undefined,
					createObjectDelivery(job)
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

function createObjectDelivery(
	job: HistoryArchiveObjectJobDTO,
	source: HistoryArchiveObjectJobDelivery['source'] = 'legacy'
): MockProxy<HistoryArchiveObjectJobDelivery> {
	const delivery = mock<HistoryArchiveObjectJobDelivery>({
		executionId: 'execution-1',
		job,
		source
	});
	delivery.acknowledge.mockResolvedValue(undefined);
	delivery.retry.mockResolvedValue(undefined);
	return delivery;
}

async function flushPromises(): Promise<void> {
	await new Promise<void>((resolve) => setImmediate(resolve));
}
