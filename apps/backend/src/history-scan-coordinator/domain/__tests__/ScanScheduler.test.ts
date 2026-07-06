import { Url } from 'http-helper';
import { Scan } from '../scan/Scan.js';
import { RestartAtLeastOneScan } from '../ScanScheduler.js';
import { ScanJob } from '../ScanJob.js';
import { ScanError, ScanErrorType } from '../scan/ScanError.js';

let counter = 0;
const createDummyHistoryBaseUrl = () => {
	const url = Url.create('https://history.stellar.org/' + counter++);
	if (url.isErr()) throw url.error;
	return url.value;
};

it('should start rolling scans for newly detected archives', function () {
	const now = new Date('2026-07-06T10:00:00.000Z');
	const scheduler = new RestartAtLeastOneScan(24, undefined, () => now);
	const archiveUrl1 = createDummyHistoryBaseUrl();
	const archiveUrl2 = createDummyHistoryBaseUrl();

	const scanJobs = scheduler.schedule(
		[archiveUrl1.value, archiveUrl2.value],
		[]
	);
	expect(scanJobs).toHaveLength(2);
	expect(scanJobs.filter((scan) => scan.isNewScanChainJob())).toHaveLength(0);
	expect(scanJobs.map((scan) => scan.chainInitDate?.toISOString())).toEqual([
		now.toISOString(),
		now.toISOString()
	]);
});

it('should continue all known scan chains instead of restarting the oldest from genesis', async function () {
	const scheduler = new RestartAtLeastOneScan();
	const archiveUrl = createDummyHistoryBaseUrl();
	const olderArchiveUrl = createDummyHistoryBaseUrl();

	const previousScan = new Scan(
		new Date('01-01-2001'),
		new Date('01-01-2001'), //older scan update
		new Date('01-01-2001'),
		archiveUrl,
		50,
		100,
		49,
		'hash'
	);
	const olderPreviousScan = new Scan(
		new Date('01-01-2000'), //oldest init date
		new Date('01-01-2002'),
		new Date('01-01-2002'),
		olderArchiveUrl,
		50,
		100,
		49,
		'hash'
	);

	const scanJobs = scheduler.schedule(
		[archiveUrl.value, olderArchiveUrl.value],
		[previousScan, olderPreviousScan]
	);
	expect(scanJobs).toHaveLength(2);
	const continueJob = scanJobs
		.filter((job) => job.url === archiveUrl.value)
		.pop() as ScanJob;
	expect(continueJob.chainInitDate?.getTime()).toEqual(
		previousScan.scanChainInitDate.getTime()
	);
	expect(continueJob.isNewScanChainJob()).toBeFalsy();
	expect(continueJob.latestScannedLedger).toEqual(
		previousScan.latestScannedLedger
	);
	expect(continueJob.latestScannedLedgerHeaderHash).toEqual(
		previousScan.latestScannedLedgerHeaderHash
	);

	const olderContinueJob = scanJobs
		.filter((scan) => scan.url === olderArchiveUrl.value)
		.pop() as ScanJob;
	expect(olderContinueJob.isNewScanChainJob()).toBeFalsy();
	expect(olderContinueJob.chainInitDate?.getTime()).toEqual(
		olderPreviousScan.scanChainInitDate.getTime()
	);
	expect(olderContinueJob.latestScannedLedger).toEqual(
		olderPreviousScan.latestScannedLedger
	);
	expect(olderContinueJob.latestScannedLedgerHeaderHash).toEqual(
		olderPreviousScan.latestScannedLedgerHeaderHash
	);
});

it('should only schedule valid history urls', () => {
	const scheduler = new RestartAtLeastOneScan();

	// Include a valid URL with trailing slash, another valid URL, and an invalid URL
	const validWithSlash = 'https://history.stellar.org/test/';
	const validNoSlash = 'https://history.stellar.org/test2';
	const invalidUrl = 'htp:://wrong';

	const jobs = scheduler.schedule(
		[validWithSlash, validNoSlash, invalidUrl],
		[]
	);

	// Only the valid URLs should be scheduled
	expect(jobs).toHaveLength(2);

	// Confirm trailing slash is removed
	const scheduledUrls = jobs.map((job) => job.url);
	expect(scheduledUrls).toContain('https://history.stellar.org/test');
	expect(scheduledUrls).toContain(validNoSlash);
	expect(scheduledUrls).not.toContain(invalidUrl);
});

it('should only schedule finished scan jobs', () => {
	const scheduler = new RestartAtLeastOneScan();

	const url = 'https://history.stellar.org/test';
	const unfinishedJob = new ScanJob(url);

	const jobs = scheduler.schedule([url], [], [unfinishedJob]);

	expect(jobs).toHaveLength(0);
});

it('should not schedule regular jobs when disabled', () => {
	const scheduler = new RestartAtLeastOneScan();
	const url = 'https://history.stellar.org/test';

	const jobs = scheduler.schedule([url], [], [], { includeRegularJobs: false });

	expect(jobs).toHaveLength(0);
});

it('should not schedule archive rechecks when any unfinished job exists for the archive', () => {
	const scheduler = new RestartAtLeastOneScan();
	const archive = createDummyHistoryBaseUrl();
	const previousErroredScan = new Scan(
		new Date('01-01-2020'),
		new Date('01-03-2020'),
		new Date('01-03-2020'),
		archive,
		128,
		255,
		127,
		'hash',
		4,
		false,
		new ScanError(
			ScanErrorType.TYPE_VERIFICATION,
			`${archive.value}/transactions/00/00/00/transactions-000000bf.xdr.gz`,
			'Wrong transaction hash'
		)
	);
	const unfinishedRollingJob = new ScanJob(
		archive.value,
		127,
		'hash',
		new Date('01-01-2020')
	);

	const jobs = scheduler.schedule(
		[archive.value],
		[previousErroredScan],
		[unfinishedRollingJob],
		{ includeRegularJobs: false }
	);

	expect(jobs).toHaveLength(0);
});

it('should schedule errored archive rechecks before regular scans', () => {
	const scheduler = new RestartAtLeastOneScan();
	const healthyArchive = createDummyHistoryBaseUrl();
	const erroredArchive = createDummyHistoryBaseUrl();
	const previousHealthyScan = new Scan(
		new Date('01-01-2020'),
		new Date('01-02-2020'),
		new Date('01-02-2020'),
		healthyArchive,
		0,
		127,
		127,
		'hash'
	);
	const previousErroredScan = new Scan(
		new Date('01-01-2020'),
		new Date('01-03-2020'),
		new Date('01-03-2020'),
		erroredArchive,
		128,
		255,
		127,
		'hash',
		4,
		false,
		new ScanError(
			ScanErrorType.TYPE_VERIFICATION,
			`${erroredArchive.value}/transactions/00/00/00/transactions-000000bf.xdr.gz`,
			'Wrong transaction hash'
		)
	);

	const jobs = scheduler.schedule(
		[healthyArchive.value, erroredArchive.value],
		[previousHealthyScan, previousErroredScan]
	);

	expect(jobs).toHaveLength(2);
	expect(jobs[0].url).toEqual(erroredArchive.value);
	expect(jobs[0].fromLedger).toEqual(128);
	expect(jobs[0].toLedger).toEqual(191);
	expect(jobs[0].concurrency).toEqual(4);
	expect(jobs[0].isNewScanChainJob()).toBeFalsy();
	expect(jobs[1].url).toEqual(healthyArchive.value);
});

it('should schedule errored archive rechecks when regular scans are disabled', () => {
	const scheduler = new RestartAtLeastOneScan();
	const archive = createDummyHistoryBaseUrl();
	const previousErroredScan = new Scan(
		new Date('01-01-2020'),
		new Date('01-03-2020'),
		new Date('01-03-2020'),
		archive,
		128,
		255,
		127,
		'hash',
		4,
		false,
		new ScanError(
			ScanErrorType.TYPE_VERIFICATION,
			`${archive.value}/transactions/00/00/00/transactions-000000bf.xdr.gz`,
			'Wrong transaction hash'
		)
	);

	const jobs = scheduler.schedule([archive.value], [previousErroredScan], [], {
		includeRegularJobs: false
	});

	expect(jobs).toHaveLength(1);
	expect(jobs[0].url).toEqual(archive.value);
	expect(jobs[0].fromLedger).toEqual(128);
	expect(jobs[0].toLedger).toEqual(191);
});

it('should verify the current window after an initial genesis access-denied scan', () => {
	const now = new Date('2026-07-06T10:00:00.000Z');
	const scheduler = new RestartAtLeastOneScan(24, undefined, () => now);
	const archive = createDummyHistoryBaseUrl();
	const previousErroredScan = new Scan(
		new Date('01-01-2020'),
		new Date('01-03-2020'),
		new Date('01-03-2020'),
		archive,
		0,
		63343359,
		0,
		null,
		1,
		false,
		new ScanError(
			ScanErrorType.TYPE_VERIFICATION,
			`${archive.value}/history/00/00/00/history-0000003f.json`,
			'HTTP 403 Forbidden'
		)
	);

	const jobs = scheduler.schedule([archive.value], [previousErroredScan], [], {
		includeRegularJobs: false
	});

	expect(jobs).toHaveLength(1);
	expect(jobs[0].url).toEqual(archive.value);
	expect(jobs[0].latestScannedLedger).toEqual(0);
	expect(jobs[0].fromLedger).toBeNull();
	expect(jobs[0].toLedger).toBeNull();
	expect(jobs[0].chainInitDate?.toISOString()).toEqual(now.toISOString());
});

it('should not prioritize worker-only setup failures as archive rechecks', () => {
	const scheduler = new RestartAtLeastOneScan();
	const archive = createDummyHistoryBaseUrl();
	const previousWorkerFailure = new Scan(
		new Date('01-01-2020'),
		new Date('01-03-2020'),
		new Date('01-03-2020'),
		archive,
		0,
		null,
		0,
		null,
		0,
		false,
		new ScanError(
			ScanErrorType.TYPE_CONNECTION,
			archive.value,
			'Could not fetch latest ledger'
		)
	);

	const jobs = scheduler.schedule(
		[archive.value],
		[previousWorkerFailure],
		[],
		{ includeRegularJobs: false }
	);

	expect(jobs).toHaveLength(0);
});

it('should cap errored archive recheck concurrency to the configured maximum', () => {
	const scheduler = new RestartAtLeastOneScan(24);
	const archive = createDummyHistoryBaseUrl();
	const previousErroredScan = new Scan(
		new Date('01-01-2020'),
		new Date('01-03-2020'),
		new Date('01-03-2020'),
		archive,
		128,
		255,
		127,
		'hash',
		50,
		false,
		new ScanError(
			ScanErrorType.TYPE_VERIFICATION,
			`${archive.value}/transactions/00/00/00/transactions-000000bf.xdr.gz`,
			'Wrong transaction hash'
		)
	);

	const jobs = scheduler.schedule([archive.value], [previousErroredScan]);

	expect(jobs).toHaveLength(1);
	expect(jobs[0].concurrency).toEqual(24);
});

it('should not schedule an errored archive recheck when a regular scan is already pending', () => {
	const scheduler = new RestartAtLeastOneScan();
	const archive = createDummyHistoryBaseUrl();
	const previousErroredScan = new Scan(
		new Date('01-01-2020'),
		new Date('01-03-2020'),
		new Date('01-03-2020'),
		archive,
		128,
		255,
		127,
		'hash',
		4,
		false,
		new ScanError(
			ScanErrorType.TYPE_VERIFICATION,
			`${archive.value}/transactions/00/00/00/transactions-000000bf.xdr.gz`,
			'Wrong transaction hash'
		)
	);

	const regularPendingJob = new ScanJob(archive.value);

	const jobs = scheduler.schedule(
		[archive.value],
		[previousErroredScan],
		[regularPendingJob]
	);

	expect(jobs).toHaveLength(0);
});

it('should not duplicate an errored archive recheck when a range scan is already pending', () => {
	const scheduler = new RestartAtLeastOneScan();
	const archive = createDummyHistoryBaseUrl();
	const previousErroredScan = new Scan(
		new Date('01-01-2020'),
		new Date('01-03-2020'),
		new Date('01-03-2020'),
		archive,
		128,
		255,
		127,
		'hash',
		4,
		false,
		new ScanError(
			ScanErrorType.TYPE_VERIFICATION,
			`${archive.value}/transactions/00/00/00/transactions-000000bf.xdr.gz`,
			'Wrong transaction hash'
		)
	);

	const pendingRecheckJob = new ScanJob(
		archive.value,
		127,
		'hash',
		previousErroredScan.scanChainInitDate,
		128,
		191,
		4
	);

	const jobs = scheduler.schedule(
		[archive.value],
		[previousErroredScan],
		[pendingRecheckJob]
	);

	expect(jobs).toHaveLength(0);
});

it('should use the failed scan range when the error url has no ledger', () => {
	const scheduler = new RestartAtLeastOneScan();
	const archive = createDummyHistoryBaseUrl();
	const previousErroredScan = new Scan(
		new Date('01-01-2020'),
		new Date('01-03-2020'),
		new Date('01-03-2020'),
		archive,
		128,
		255,
		127,
		'hash',
		4,
		false,
		new ScanError(
			ScanErrorType.TYPE_VERIFICATION,
			`${archive.value}/bucket/aa/bb/cc/bucket-aabbcc.xdr.gz`,
			'Wrong bucket hash'
		)
	);

	const jobs = scheduler.schedule([archive.value], [previousErroredScan]);

	expect(jobs).toHaveLength(1);
	expect(jobs[0].fromLedger).toEqual(128);
	expect(jobs[0].toLedger).toEqual(255);
});

it('should recheck through the latest known errored ledger', () => {
	const scheduler = new RestartAtLeastOneScan();
	const archive = createDummyHistoryBaseUrl();
	const previousErroredScan = new Scan(
		new Date('01-01-2020'),
		new Date('01-03-2020'),
		new Date('01-03-2020'),
		archive,
		128,
		255,
		127,
		'hash',
		4,
		false,
		null,
		[
			new ScanError(
				ScanErrorType.TYPE_VERIFICATION,
				`${archive.value}/ledger/00/00/00/ledger-000000bf.xdr.gz`,
				'Missing ledger'
			),
			new ScanError(
				ScanErrorType.TYPE_VERIFICATION,
				`${archive.value}/transactions/00/00/00/transactions-000000df.xdr.gz`,
				'Wrong transaction hash'
			)
		]
	);

	const jobs = scheduler.schedule([archive.value], [previousErroredScan]);

	expect(jobs).toHaveLength(1);
	expect(jobs[0].fromLedger).toEqual(128);
	expect(jobs[0].toLedger).toEqual(223);
});

it('should ignore worker issues when deriving archive recheck range', () => {
	const scheduler = new RestartAtLeastOneScan();
	const archive = createDummyHistoryBaseUrl();
	const previousErroredScan = new Scan(
		new Date('01-01-2020'),
		new Date('01-03-2020'),
		new Date('01-03-2020'),
		archive,
		128,
		255,
		127,
		'hash',
		4,
		false,
		null,
		[
			new ScanError(
				ScanErrorType.TYPE_VERIFICATION,
				`${archive.value}/ledger/00/00/00/ledger-000000bf.xdr.gz`,
				'Missing ledger'
			),
			new ScanError(
				ScanErrorType.TYPE_CONNECTION,
				archive.value,
				'Could not fetch latest ledger'
			)
		]
	);

	const jobs = scheduler.schedule([archive.value], [previousErroredScan]);

	expect(jobs).toHaveLength(1);
	expect(jobs[0].fromLedger).toEqual(128);
	expect(jobs[0].toLedger).toEqual(191);
});

it('should recheck the failed scan range when a known error has no ledger', () => {
	const scheduler = new RestartAtLeastOneScan();
	const archive = createDummyHistoryBaseUrl();
	const previousErroredScan = new Scan(
		new Date('01-01-2020'),
		new Date('01-03-2020'),
		new Date('01-03-2020'),
		archive,
		128,
		255,
		127,
		'hash',
		4,
		false,
		null,
		[
			new ScanError(
				ScanErrorType.TYPE_VERIFICATION,
				`${archive.value}/ledger/00/00/00/ledger-000000bf.xdr.gz`,
				'Missing ledger'
			),
			new ScanError(
				ScanErrorType.TYPE_VERIFICATION,
				`${archive.value}/bucket/aa/bb/cc/bucket-aabbcc.xdr.gz`,
				'Wrong bucket hash'
			)
		]
	);

	const jobs = scheduler.schedule([archive.value], [previousErroredScan]);

	expect(jobs).toHaveLength(1);
	expect(jobs[0].fromLedger).toEqual(128);
	expect(jobs[0].toLedger).toEqual(255);
});
