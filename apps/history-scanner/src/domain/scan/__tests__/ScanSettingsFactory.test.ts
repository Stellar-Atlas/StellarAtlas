import { mock } from 'jest-mock-extended';
import { ArchivePerformanceTester } from '../../scanner/ArchivePerformanceTester.js';
import { CategoryScanner } from '../../scanner/CategoryScanner.js';
import { ScanSettingsFactory } from '../ScanSettingsFactory.js';
import { createDummyHistoryBaseUrl } from '../../history-archive/__fixtures__/HistoryBaseUrl.js';
import { ScanJob } from '../ScanJob.js';
import { err, ok } from 'neverthrow';
import { ScanError, ScanErrorType } from '../ScanError.js';
import { Scan } from '../Scan.js';
import type { LatestLedgerArchiveState } from '../../scanner/CategoryScanner.js';

function latestLedgerState(ledger: number): LatestLedgerArchiveState {
	return {
		ledger,
		archiveMetadata: {
			stellarHistoryUrl:
				'https://history.stellar.org/.well-known/stellar-history.json',
			stellarHistory: {
				version: 1,
				server: 'stellar-core',
				currentLedger: ledger,
				currentBuckets: []
			},
			observedAt: '2026-07-05T00:00:00.000Z'
		}
	};
}

it('should prioritize concurrency, fromLedger and toLedger parameters', async function () {
	const performanceTester = mock<ArchivePerformanceTester>();
	const categoryScanner = mock<CategoryScanner>();
	categoryScanner.findLatestLedger.mockResolvedValue(
		ok(latestLedgerState(500))
	);
	const settingsFactory = new ScanSettingsFactory(
		categoryScanner,
		performanceTester
	);

	const scanJob = ScanJob.newScanChain(
		createDummyHistoryBaseUrl(),
		100,
		200,
		7
	);
	const settingsOrError = await settingsFactory.determineSettings(scanJob);
	expect(settingsOrError.isOk()).toBeTruthy();
	if (settingsOrError.isErr()) throw settingsOrError.error;
	expect(settingsOrError.value.concurrency).toEqual(7);
	expect(settingsOrError.value.fromLedger).toEqual(100);
	expect(settingsOrError.value.toLedger).toEqual(200);
	expect(
		settingsOrError.value.archiveMetadata?.stellarHistory.currentLedger
	).toBe(500);
	expect(categoryScanner.findLatestLedger).toHaveBeenCalledTimes(1);
});

it('should fall back if concurrency cannot be determined', async function () {
	const performanceTester = mock<ArchivePerformanceTester>();
	performanceTester.test.mockResolvedValue(err(new Error('test')));
	const categoryScanner = mock<CategoryScanner>();
	categoryScanner.findLatestLedger.mockResolvedValue(
		ok(latestLedgerState(500))
	);
	const settingsFactory = new ScanSettingsFactory(
		categoryScanner,
		performanceTester
	);
	const scanJob = ScanJob.newScanChain(createDummyHistoryBaseUrl());
	const settingsOrError = await settingsFactory.determineSettings(scanJob);

	expect(settingsOrError.isOk()).toBeTruthy();
	if (settingsOrError.isErr()) throw settingsOrError.error;
	expect(settingsOrError.value.concurrency).toEqual(24);
});

it('should clamp stored concurrency to the configured maximum', async function () {
	const performanceTester = mock<ArchivePerformanceTester>();
	const categoryScanner = mock<CategoryScanner>();
	categoryScanner.findLatestLedger.mockResolvedValue(
		ok(latestLedgerState(500))
	);
	const settingsFactory = new ScanSettingsFactory(
		categoryScanner,
		performanceTester,
		120960,
		24,
		24
	);

	const scanJob = ScanJob.newScanChain(
		createDummyHistoryBaseUrl(),
		100,
		200,
		50
	);
	const settingsOrError = await settingsFactory.determineSettings(scanJob);

	expect(settingsOrError.isOk()).toBeTruthy();
	if (settingsOrError.isErr()) throw settingsOrError.error;
	expect(settingsOrError.value.concurrency).toEqual(24);
});

it('should return error if latest ledger cannot be determined', async function () {
	const performanceTester = mock<ArchivePerformanceTester>();
	performanceTester.test.mockResolvedValue(
		ok({
			optimalConcurrency: 10,
			timeMsPerFile: 100,
			isSlowArchive: false
		})
	);
	const categoryScanner = mock<CategoryScanner>();
	categoryScanner.findLatestLedger.mockResolvedValue(
		err(
			new ScanError(
				ScanErrorType.TYPE_CONNECTION,
				createDummyHistoryBaseUrl().value,
				'error'
			)
		)
	);
	const settingsFactory = new ScanSettingsFactory(
		categoryScanner,
		performanceTester
	);
	const scanJob = ScanJob.newScanChain(createDummyHistoryBaseUrl());
	const settingsOrError = await settingsFactory.determineSettings(scanJob);

	expect(settingsOrError.isErr()).toBeTruthy();
});

it('should determine optimal concurrency, signal slow archive and update toLedger accordingly', async function () {
	const performanceTester = mock<ArchivePerformanceTester>();
	performanceTester.test.mockResolvedValue(
		ok({
			optimalConcurrency: 10,
			timeMsPerFile: 500,
			isSlowArchive: true
		})
	);
	const categoryScanner = mock<CategoryScanner>();
	categoryScanner.findLatestLedger.mockResolvedValue(
		ok(latestLedgerState(500))
	);
	const settingsFactory = new ScanSettingsFactory(
		categoryScanner,
		performanceTester
	);
	const scanJob = ScanJob.newScanChain(createDummyHistoryBaseUrl());
	const settingsWithZeroFromLedgerOrError =
		await settingsFactory.determineSettings(scanJob);

	expect(settingsWithZeroFromLedgerOrError.isOk()).toBeTruthy();
	if (settingsWithZeroFromLedgerOrError.isErr())
		throw settingsWithZeroFromLedgerOrError.error;
	expect(settingsWithZeroFromLedgerOrError.value.concurrency).toEqual(10);
	expect(settingsWithZeroFromLedgerOrError.value.isSlowArchive).toEqual(true);
	expect(settingsWithZeroFromLedgerOrError.value.fromLedger).toEqual(0);

	categoryScanner.findLatestLedger.mockResolvedValue(
		ok(latestLedgerState(10000000))
	);
	const settingsOrError = await settingsFactory.determineSettings(scanJob);

	expect(settingsOrError.isOk()).toBeTruthy();
	if (settingsOrError.isErr()) throw settingsOrError.error;
	expect(settingsOrError.value.concurrency).toEqual(10);
	expect(settingsOrError.value.isSlowArchive).toEqual(true);
	expect(settingsOrError.value.fromLedger > 0).toBeTruthy();
});

it('should detect a slow archive', async function () {
	const performanceTester = mock<ArchivePerformanceTester>();
	performanceTester.test.mockResolvedValue(
		ok({
			optimalConcurrency: 10,
			timeMsPerFile: 100,
			isSlowArchive: true
		})
	);
	const categoryScanner = mock<CategoryScanner>();
	categoryScanner.findLatestLedger.mockResolvedValue(
		ok(latestLedgerState(500))
	);
	const settingsFactory = new ScanSettingsFactory(
		categoryScanner,
		performanceTester
	);
	const scanJob = ScanJob.newScanChain(createDummyHistoryBaseUrl());
	const settingsOrError = await settingsFactory.determineSettings(scanJob);
	if (settingsOrError.isErr()) throw settingsOrError.error;

	expect(settingsOrError.value.isSlowArchive).toEqual(true);
});

it('should continue a scan from the previous latest scanned ledger', async function () {
	const performanceTester = mock<ArchivePerformanceTester>();
	const categoryScanner = mock<CategoryScanner>();
	categoryScanner.findLatestLedger.mockResolvedValue(
		ok(latestLedgerState(127))
	);
	const settingsFactory = new ScanSettingsFactory(
		categoryScanner,
		performanceTester
	);

	const previousScan = new Scan(
		new Date(),
		new Date(),
		new Date(),
		createDummyHistoryBaseUrl(),
		0,
		63,
		63,
		'hash'
	);
	const scanJob = ScanJob.continueScanChain(previousScan, 127, 10);
	const settingsOrError = await settingsFactory.determineSettings(scanJob);

	expect(settingsOrError.isOk()).toBeTruthy();
	if (settingsOrError.isErr()) throw settingsOrError.error;
	expect(settingsOrError.value.fromLedger).toEqual(64);
});

it('should only scan a max number of ledgers for a slow archive and reset latestLedgerHeader if necessary', async () => {
	const performanceTester = mock<ArchivePerformanceTester>();
	performanceTester.test.mockResolvedValue(
		ok({
			optimalConcurrency: 10,
			timeMsPerFile: 500,
			isSlowArchive: true
		})
	);
	const categoryScanner = mock<CategoryScanner>();
	categoryScanner.findLatestLedger.mockResolvedValue(
		ok(latestLedgerState(127))
	);
	const settingsFactory = new ScanSettingsFactory(
		categoryScanner,
		performanceTester,
		10
	);

	const previousScan = new Scan(
		new Date(),
		new Date(),
		new Date(),
		createDummyHistoryBaseUrl(),
		0,
		63,
		63,
		'hash'
	);
	const scanJob = ScanJob.continueScanChain(previousScan, 127);
	const settingsOrError = await settingsFactory.determineSettings(scanJob);

	expect(settingsOrError.isOk()).toBeTruthy();
	if (settingsOrError.isErr()) return;
	expect(settingsOrError.value.isSlowArchive).toBeTruthy();
	expect(settingsOrError.value.fromLedger).toEqual(127 - 10);
	expect(settingsOrError.value.toLedger).toEqual(127);
	expect(settingsOrError.value.latestScannedLedger).toEqual(0);
	expect(settingsOrError.value.latestScannedLedgerHeaderHash).toEqual(null);
});

it(
	'should continue from the previous scan if it is a slow archive and the' +
		' range is less than the max allowed number of ledgers',
	async function () {
		const performanceTester = mock<ArchivePerformanceTester>();
		performanceTester.test.mockResolvedValue(
			ok({
				optimalConcurrency: 10,
				timeMsPerFile: 500,
				isSlowArchive: true
			})
		);
		const categoryScanner = mock<CategoryScanner>();
		categoryScanner.findLatestLedger.mockResolvedValue(
			ok(latestLedgerState(127))
		);
		const settingsFactory = new ScanSettingsFactory(
			categoryScanner,
			performanceTester,
			100
		);

		const previousScan = new Scan(
			new Date(),
			new Date(),
			new Date(),
			createDummyHistoryBaseUrl(),
			0,
			63,
			63,
			'hash'
		);
		const scanJob = ScanJob.continueScanChain(previousScan, 127, 10);
		const settingsOrError = await settingsFactory.determineSettings(scanJob);

		expect(settingsOrError.isOk()).toBeTruthy();
		if (settingsOrError.isErr()) return;
		expect(settingsOrError.value.fromLedger).toEqual(64);
		expect(settingsOrError.value.toLedger).toEqual(127);
	}
);
