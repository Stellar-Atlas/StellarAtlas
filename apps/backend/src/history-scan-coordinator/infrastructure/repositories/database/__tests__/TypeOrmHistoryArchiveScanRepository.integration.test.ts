import Kernel from '@core/infrastructure/Kernel.js';
import { ConfigMock } from '@core/config/__mocks__/configMock.js';
import { TYPES } from '@history-scan-coordinator/infrastructure/di/di-types.js';
import type { ScanRepository } from '@history-scan-coordinator/domain/scan/ScanRepository.js';
import { Scan } from '@history-scan-coordinator/domain/scan/Scan.js';
import { ScanError, ScanErrorType } from '@history-scan-coordinator/domain/scan/ScanError.js';
import { Url } from 'http-helper';

let kernel: Kernel;
jest.setTimeout(60000); //slow integration tests
beforeEach(async () => {
	kernel = await Kernel.getInstance(new ConfigMock());
});

afterEach(async () => {
	await kernel.close();
});

let counter = 0;
const createDummyHistoryBaseUrl = () => {
	const url = Url.create('https://history.stellar.org/' + counter++);
	if (url.isErr()) throw url.error;
	return url.value;
};

it('should find the latest scans', async function () {
	const repo: ScanRepository = kernel.container.get(
		TYPES.HistoryArchiveScanRepository
	);

	const url = createDummyHistoryBaseUrl();
	const scan = new Scan(
		new Date('12/12/2000'),
		new Date('12/12/2000'),
		new Date('12/12/2000'),
		url,
		0,
		200
	);
	const scan2 = new Scan(
		new Date('12/12/2000'),
		new Date('12/12/2001'),
		new Date('12/12/2001'),
		url,
		201,
		400
	);

	const scanWithErrorUrl = createDummyHistoryBaseUrl();
	const scanWithError = new Scan(
		new Date('12/12/2000'),
		new Date('12/12/2001'),
		new Date('12/12/2001'),
		scanWithErrorUrl,
		201,
		400,
		0,
		null,
		0,
		null,
		new ScanError(
			ScanErrorType.TYPE_VERIFICATION,
			scanWithErrorUrl.value,
			'info'
		)
	);

	await repo.save([scan, scan2, scanWithError]);

	const latest = await repo.findLatest();

	expect(latest.length).toEqual(2);
	expect(
		latest.find((scan) => scan.baseUrl.value === url.value)?.startDate.getTime()
	).toEqual(new Date('12/12/2001').getTime());

	const foundErrorScan = latest.find(
		(scan) => scan.baseUrl.value === scanWithErrorUrl.value
	);
	expect(foundErrorScan?.error).toBeInstanceOf(ScanError);
	expect(foundErrorScan?.error?.url).toEqual(scanWithErrorUrl.value);
	expect(foundErrorScan?.error?.message).toEqual('info');
	expect(foundErrorScan?.scanErrors).toHaveLength(1);
	expect(foundErrorScan?.scanErrors[0]?.message).toEqual('info');

	const latestByUrl = await repo.findLatestByUrl(scanWithErrorUrl.value);
	expect(latestByUrl).toBeDefined();
	expect(latestByUrl?.error).toBeInstanceOf(ScanError);
	expect(latestByUrl?.scanErrors).toHaveLength(1);
});

it('should prefer the latest verification scan over a newer worker setup failure', async function () {
	const repo: ScanRepository = kernel.container.get(
		TYPES.HistoryArchiveScanRepository
	);

	const url = createDummyHistoryBaseUrl();
	const verificationError = new ScanError(
		ScanErrorType.TYPE_VERIFICATION,
		url.value + '/transactions/00/00/00.xdr.gz',
		'Wrong transaction hash'
	);
	const verificationScan = new Scan(
		new Date('2026-07-01T00:00:00.000Z'),
		new Date('2026-07-01T00:00:00.000Z'),
		new Date('2026-07-01T00:05:00.000Z'),
		url,
		100,
		200,
		150,
		null,
		12,
		false,
		verificationError
	);
	const workerFailure = new Scan(
		new Date('2026-07-01T00:00:00.000Z'),
		new Date('2026-07-01T00:10:00.000Z'),
		new Date('2026-07-01T00:12:00.000Z'),
		url,
		151,
		null,
		150,
		null,
		0,
		null,
		new ScanError(
			ScanErrorType.TYPE_CONNECTION,
			url.value,
			'Could not fetch latest ledger'
		)
	);

	await repo.save([verificationScan, workerFailure]);

	const latestByUrl = await repo.findLatestByUrl(url.value);
	expect(latestByUrl?.startDate).toEqual(verificationScan.startDate);
	expect(latestByUrl?.hasArchiveVerificationError()).toBe(true);

	const latest = await repo.findLatest();
	const foundScan = latest.find((scan) => scan.baseUrl.value === url.value);
	expect(foundScan?.startDate).toEqual(verificationScan.startDate);
	expect(foundScan?.hasArchiveVerificationError()).toBe(true);
});

it('should return worker setup failures when no verification scan exists', async function () {
	const repo: ScanRepository = kernel.container.get(
		TYPES.HistoryArchiveScanRepository
	);

	const url = createDummyHistoryBaseUrl();
	const workerFailure = new Scan(
		new Date('2026-07-01T00:00:00.000Z'),
		new Date('2026-07-01T00:10:00.000Z'),
		new Date('2026-07-01T00:12:00.000Z'),
		url,
		0,
		null,
		0,
		null,
		0,
		null,
		new ScanError(
			ScanErrorType.TYPE_CONNECTION,
			url.value,
			'Could not fetch latest ledger'
		)
	);

	await repo.save([workerFailure]);

	const latestByUrl = await repo.findLatestByUrl(url.value);
	expect(latestByUrl?.startDate).toEqual(workerFailure.startDate);
	expect(latestByUrl?.hasWorkerIssue()).toBe(true);
});
