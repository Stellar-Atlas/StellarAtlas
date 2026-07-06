import { NodeScannerHistoryArchiveStep } from '../NodeScannerHistoryArchiveStep.js';
import { mock } from 'jest-mock-extended';
import { HistoryArchiveStatusFinder } from '../HistoryArchiveStatusFinder.js';
import { NodeScan } from '../NodeScan.js';
import type { HistoryArchiveScanService } from '../history/HistoryArchiveScanService.js';
import type { Logger } from '@core/services/Logger.js';
import { err, ok, type Result } from 'neverthrow';

describe('NodeScannerHistoryArchiveStep', () => {
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
		historyArchiveScanService.scheduleScans.mockResolvedValue(ok(undefined));
	});

	it('should update full validator status', async () => {
		const nodeScan = mock<NodeScan>();
		nodeScan.getHistoryArchiveUrls.mockReturnValue(new Map([['a', 'url']]));
		const upToDateArchives = new Set(['a']);
		historyArchiveStatusFinder.getNodesWithUpToDateHistoryArchives.mockResolvedValue(
			upToDateArchives
		);
		const verificationErrors = new Set(['b']);
		historyArchiveStatusFinder.getNodesWithHistoryArchiveVerificationErrors.mockResolvedValue(
			verificationErrors
		);
		await historyArchiveStep.execute(nodeScan);
		expect(
			historyArchiveStatusFinder.getNodesWithUpToDateHistoryArchives
		).toHaveBeenCalled();
		expect(
			historyArchiveStatusFinder.getNodesWithHistoryArchiveVerificationErrors
		).toHaveBeenCalled();
		expect(nodeScan.updateHistoryArchiveUpToDateStatus).toHaveBeenCalledWith(
			upToDateArchives
		);
		expect(
			nodeScan.updateHistoryArchiveVerificationStatus
		).toHaveBeenCalledWith(verificationErrors);
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
			{ archiveUrlCount: 1 }
		);
	});

	it('should await archive scan scheduling before completing', async () => {
		const nodeScan = mock<NodeScan>();
		const urls = new Map<string, string>([['a', 'url']]);
		nodeScan.getHistoryArchiveUrls.mockReturnValue(urls);
		const scheduling = deferred<Result<void, Error>>();
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
	});
});

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
