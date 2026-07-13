import { NodeScannerHistoryArchiveStep } from '../NodeScannerHistoryArchiveStep.js';
import { mock } from 'jest-mock-extended';
import { HistoryArchiveStatusFinder } from '../HistoryArchiveStatusFinder.js';
import { NodeScan } from '../NodeScan.js';
import type { HistoryArchiveScanService } from '../history/HistoryArchiveScanService.js';
import type { HistoryArchiveSchedulingResult } from '../history/HistoryArchiveScanService.js';
import type { Logger } from '@core/services/Logger.js';
import { err, ok, type Result } from 'neverthrow';

describe('NodeScannerHistoryArchiveStep', () => {
	const originalSchedulingSetting =
		process.env.HISTORY_ARCHIVE_OBJECT_SCHEDULING_ENABLED;
	const historyArchiveStatusFinder = mock<HistoryArchiveStatusFinder>();
	const historyArchiveScanService = mock<HistoryArchiveScanService>();
	const logger = mock<Logger>();
	const historyArchiveStep = new NodeScannerHistoryArchiveStep(
		historyArchiveStatusFinder,
		historyArchiveScanService,
		logger
	);

	beforeEach(() => {
		jest.clearAllMocks();
		delete process.env.HISTORY_ARCHIVE_OBJECT_SCHEDULING_ENABLED;
		historyArchiveScanService.scheduleScans.mockResolvedValue(
			ok(makeSchedulingResult())
		);
	});

	afterAll(() => {
		if (originalSchedulingSetting === undefined) {
			delete process.env.HISTORY_ARCHIVE_OBJECT_SCHEDULING_ENABLED;
		} else {
			process.env.HISTORY_ARCHIVE_OBJECT_SCHEDULING_ENABLED =
				originalSchedulingSetting;
		}
	});

	it('should update full validator status', async () => {
		const nodeScan = mock<NodeScan>();
		nodeScan.getHistoryArchiveUrls.mockReturnValue(new Map([['a', 'url']]));
		const upToDateArchives = new Set(['a']);
		historyArchiveStatusFinder.getNodesWithUpToDateHistoryArchives.mockResolvedValue(
			upToDateArchives
		);
		await historyArchiveStep.execute(nodeScan);
		expect(
			historyArchiveStatusFinder.getNodesWithUpToDateHistoryArchives
		).toHaveBeenCalled();
		expect(nodeScan.updateHistoryArchiveUpToDateStatus).toHaveBeenCalledWith(
			upToDateArchives
		);
		expect(
			historyArchiveScanService.findLatestHistoricalRangeScans
		).not.toHaveBeenCalled();
	});

	it('should schedule new archive scans', async () => {
		const nodeScan = mock<NodeScan>();
		const urls = new Map<string, string>([['a', 'url']]);
		nodeScan.getHistoryArchiveUrls.mockReturnValue(urls);
		await historyArchiveStep.execute(nodeScan);
		expect(historyArchiveScanService.scheduleScans).toHaveBeenCalledWith(
			Array.from(urls.values())
		);
		expect(logger.info).toHaveBeenCalledWith(
			'History archive scan scheduling completed',
			{
				archiveUrlCount: 1,
				scheduledCount: 1,
				duplicateSuppressedCount: 0,
				schedulerErrorCount: 0
			}
		);
		expect(
			nodeScan.updateHistoryArchiveSchedulingCounters
		).toHaveBeenCalledWith(makeSchedulingResult());
	});

	it('should await archive scan scheduling before completing', async () => {
		const nodeScan = mock<NodeScan>();
		const urls = new Map<string, string>([['a', 'url']]);
		nodeScan.getHistoryArchiveUrls.mockReturnValue(urls);
		const scheduling =
			deferred<Result<HistoryArchiveSchedulingResult, Error>>();
		let completed = false;
		historyArchiveScanService.scheduleScans.mockReturnValue(scheduling.promise);

		const execution = historyArchiveStep.execute(nodeScan).then(() => {
			completed = true;
		});
		await Promise.resolve();

		expect(completed).toBe(false);
		scheduling.resolve(ok(undefined));
		await execution;
		expect(completed).toBe(true);
	});

	it('should keep archive status checks active while scheduling is paused', async () => {
		process.env.HISTORY_ARCHIVE_OBJECT_SCHEDULING_ENABLED = 'false';
		const nodeScan = mock<NodeScan>();
		nodeScan.getHistoryArchiveUrls.mockReturnValue(new Map([['a', 'url']]));

		await historyArchiveStep.execute(nodeScan);

		expect(historyArchiveScanService.scheduleScans).not.toHaveBeenCalled();
		expect(
			nodeScan.updateHistoryArchiveSchedulingCounters
		).toHaveBeenCalledWith({
			discoveredArchiveUrlCount: 1,
			scheduledArchiveScanJobCount: 0,
			duplicateSuppressedArchiveScanJobCount: 0,
			schedulerErrorCount: 0
		});
		expect(logger.warn).toHaveBeenCalledWith(
			'History archive object scheduling is paused',
			{ archiveUrlCount: 1 }
		);
	});

	it('should log archive scan scheduling errors', async () => {
		const nodeScan = mock<NodeScan>();
		const urls = new Map<string, string>([['a', 'url']]);
		const error = new Error('scheduler failed');
		nodeScan.getHistoryArchiveUrls.mockReturnValue(urls);
		historyArchiveScanService.scheduleScans.mockResolvedValue(err(error));

		await historyArchiveStep.execute(nodeScan);

		expect(logger.error).toHaveBeenCalledWith(
			'History archive scan scheduling failed',
			{ archiveUrlCount: 1, errorMessage: error.message }
		);
		expect(
			nodeScan.updateHistoryArchiveSchedulingCounters
		).toHaveBeenCalledWith({
			discoveredArchiveUrlCount: 1,
			scheduledArchiveScanJobCount: 0,
			duplicateSuppressedArchiveScanJobCount: 0,
			schedulerErrorCount: 1
		});
	});
});

function makeSchedulingResult(): HistoryArchiveSchedulingResult {
	return {
		discoveredArchiveUrlCount: 1,
		scheduledArchiveScanJobCount: 1,
		duplicateSuppressedArchiveScanJobCount: 0,
		schedulerErrorCount: 0
	};
}

function deferred<T>(): {
	readonly promise: Promise<T>;
	readonly resolve: (value: T) => void;
} {
	let resolve: (value: T) => void = () => undefined;
	const promise = new Promise<T>((promiseResolve) => {
		resolve = promiseResolve;
	});

	return { promise, resolve };
}
