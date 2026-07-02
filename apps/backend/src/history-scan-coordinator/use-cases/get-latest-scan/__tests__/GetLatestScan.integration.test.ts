import Kernel from '@core/infrastructure/Kernel.js';
import { ConfigMock } from '@core/config/__mocks__/configMock.js';
import { TYPES } from '@history-scan-coordinator/infrastructure/di/di-types.js';
import type { ScanRepository } from '@history-scan-coordinator/domain/scan/ScanRepository.js';
import { Scan } from '@history-scan-coordinator/domain/scan/Scan.js';
import { GetLatestScan } from '../GetLatestScan.js';
import { HistoryArchiveScan } from 'shared';
import { InvalidUrlError } from '../InvalidUrlError.js';
import { Url } from 'http-helper';

let kernel: Kernel;
jest.setTimeout(60000); //slow integration tests
beforeAll(async () => {
	kernel = await Kernel.getInstance(new ConfigMock());
});

afterAll(async () => {
	await kernel.close();
});

it('fetch latest archive', async function () {
	const historyArchiveScanRepository: ScanRepository = kernel.container.get(
		TYPES.HistoryArchiveScanRepository
	);
	const urlResult = Url.create('https://test.com');
	if (urlResult.isErr()) throw new Error('Invalid url');
	const url = urlResult.value;
	await historyArchiveScanRepository.save([
		new Scan(new Date(), new Date(), new Date(), url, 0, null)
	]);
	const getLatestScan = kernel.container.get(GetLatestScan);
	const scanOrError = await getLatestScan.execute({
		url: url.value
	});

	expect(scanOrError.isOk()).toBeTruthy();
	if (!scanOrError.isOk()) return;
	expect(scanOrError.value).toBeInstanceOf(HistoryArchiveScan);
	if (!scanOrError.value) return;
	expect(scanOrError.value.url).toEqual(url.value);
});

it('should return InvalidUrl', async function () {
	const getLatestScan = kernel.container.get(GetLatestScan);
	const scanOrError = await getLatestScan.execute({
		url: 'archiveorg'
	});

	expect(scanOrError.isErr()).toBeTruthy();
	if (!scanOrError.isErr()) return;
	expect(scanOrError.error).toBeInstanceOf(InvalidUrlError);
});
