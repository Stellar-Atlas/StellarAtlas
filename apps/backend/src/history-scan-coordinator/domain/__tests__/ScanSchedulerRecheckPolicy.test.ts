import { Url } from 'http-helper';
import { RestartAtLeastOneScan } from '../ScanScheduler.js';
import { Scan } from '../scan/Scan.js';
import { ScanError, ScanErrorType } from '../scan/ScanError.js';

const dayMs = 24 * 60 * 60 * 1000;
let counter = 0;

const createHistoryBaseUrl = () => {
	const url = Url.create('https://history.stellar.org/recheck-' + counter++);
	if (url.isErr()) throw url.error;
	return url.value;
};

const createVerificationErrorScan = (
	endDate: Date,
	fromLedger = 128,
	toLedger = 255
) => {
	const archive = createHistoryBaseUrl();
	return new Scan(
		new Date('2026-01-01T00:00:00.000Z'),
		endDate,
		endDate,
		archive,
		fromLedger,
		toLedger,
		fromLedger - 1,
		'hash',
		4,
		false,
		new ScanError(
			ScanErrorType.TYPE_VERIFICATION,
			`${archive.value}/transactions/00/00/00/transactions-000000bf.xdr.gz`,
			'Wrong transaction hash'
		)
	);
};

describe('RestartAtLeastOneScan archive recheck policy', () => {
	const now = new Date('2026-07-03T00:00:00.000Z');

	it('should skip recent archive verification errors', () => {
		const scheduler = new RestartAtLeastOneScan(24, dayMs, () => now);
		const recentErroredScan = createVerificationErrorScan(
			new Date('2026-07-02T12:00:00.000Z')
		);

		const jobs = scheduler.schedule(
			[recentErroredScan.baseUrl.value],
			[recentErroredScan],
			[],
			{ includeRegularJobs: false }
		);

		expect(jobs).toHaveLength(0);
	});

	it('should schedule overdue archive verification errors', () => {
		const scheduler = new RestartAtLeastOneScan(24, dayMs, () => now);
		const overdueErroredScan = createVerificationErrorScan(
			new Date('2026-07-01T23:59:59.000Z')
		);

		const jobs = scheduler.schedule(
			[overdueErroredScan.baseUrl.value],
			[overdueErroredScan],
			[],
			{ includeRegularJobs: false }
		);

		expect(jobs).toHaveLength(1);
		expect(jobs[0].url).toEqual(overdueErroredScan.baseUrl.value);
		expect(jobs[0].fromLedger).toEqual(128);
		expect(jobs[0].toLedger).toEqual(191);
	});
});
