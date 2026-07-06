import 'reflect-metadata';
import { mock, type MockProxy } from 'jest-mock-extended';
import { ok } from 'neverthrow';
import type { ExceptionLogger } from 'exception-logger';
import type { HttpService } from 'http-helper';
import type { JobMonitor } from 'job-monitor';
import type { Logger } from 'logger';
import type {
	HistoryArchiveObjectJobDTO,
	ScanCoordinatorService
} from '../../../domain/scan/ScanCoordinatorService.js';
import { BucketCache } from '../../../domain/scanner/BucketCache.js';
import { HistoryArchiveStateValidator } from '../../../domain/history-archive/HistoryArchiveStateValidator.js';
import { VerifyArchiveObjects } from '../VerifyArchiveObjects.js';

type TestProgress = {
	bytesDownloaded: number | null;
	claimAttempt: number;
	workerStage: string;
};

type TestableVerifyArchiveObjects = VerifyArchiveObjects & {
	activeObjectProgress: Map<string, TestProgress>;
	touchObject(remoteId: string): Promise<void>;
	verifyObject(job: HistoryArchiveObjectJobDTO): Promise<void>;
};

describe('VerifyArchiveObjects', () => {
	let scanCoordinator: MockProxy<ScanCoordinatorService>;
	let verifier: TestableVerifyArchiveObjects;

	beforeEach(() => {
		scanCoordinator = mock<ScanCoordinatorService>();
		scanCoordinator.touchHistoryArchiveObject.mockResolvedValue(ok(undefined));
		scanCoordinator.failHistoryArchiveObject.mockResolvedValue(ok(undefined));
		scanCoordinator.completeHistoryArchiveObject.mockResolvedValue(ok(undefined));

		const jobMonitor = mock<JobMonitor>();
		jobMonitor.checkIn.mockResolvedValue(ok(undefined));

		verifier = new VerifyArchiveObjects(
			scanCoordinator,
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

	it('does not send a redundant heartbeat immediately after claiming an object', async () => {
		await verifier.verifyObject(createObjectJob({ objectType: 'unsupported' }));

		expect(scanCoordinator.touchHistoryArchiveObject).not.toHaveBeenCalled();
		expect(scanCoordinator.failHistoryArchiveObject).toHaveBeenCalledWith(
			'object-1',
			expect.objectContaining({ claimAttempt: 3 })
		);
	});

	it('coalesces overlapping heartbeat writes for the same object', async () => {
		let resolveTouch: ((value: ReturnType<typeof ok<void, Error>>) => void) | null =
			null;
		scanCoordinator.touchHistoryArchiveObject.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					resolveTouch = resolve;
				})
		);
		verifier.activeObjectProgress.set('object-1', {
			bytesDownloaded: 1024,
			claimAttempt: 3,
			workerStage: 'downloading_bucket'
		});

		const first = verifier.touchObject('object-1');
		const second = verifier.touchObject('object-1');

		expect(scanCoordinator.touchHistoryArchiveObject).toHaveBeenCalledTimes(1);
		resolveTouch?.(ok(undefined));
		await Promise.all([first, second]);

		await verifier.touchObject('object-1');

		expect(scanCoordinator.touchHistoryArchiveObject).toHaveBeenCalledTimes(2);
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
