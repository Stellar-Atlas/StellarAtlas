import { mock, MockProxy } from 'jest-mock-extended';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
import type { ScanRepository } from '@history-scan-coordinator/domain/scan/ScanRepository.js';
import { Scan } from '@history-scan-coordinator/domain/scan/Scan.js';
import {
	ScanError,
	ScanErrorType
} from '@history-scan-coordinator/domain/scan/ScanError.js';
import { GetArchiveScans } from '../GetArchiveScans.js';
import { Url } from 'http-helper';

describe('GetArchiveScans', () => {
	let getArchiveScans: GetArchiveScans;
	let scanRepositoryMock: MockProxy<ScanRepository>;
	let exceptionLoggerMock: MockProxy<ExceptionLogger>;

	beforeEach(() => {
		jest.useFakeTimers().setSystemTime(new Date('2026-07-03T12:00:00.000Z'));
		scanRepositoryMock = mock<ScanRepository>();
		exceptionLoggerMock = mock<ExceptionLogger>();
		getArchiveScans = new GetArchiveScans(
			scanRepositoryMock,
			exceptionLoggerMock
		);
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	it('should return a bounded latest archive scan list', async () => {
		const baseUrl = Url.create('https://history.example.com');
		if (baseUrl.isErr()) throw baseUrl.error;
		const scan = new Scan(
			new Date('2026-07-03T10:00:00.000Z'),
			new Date('2026-07-03T10:00:00.000Z'),
			new Date('2026-07-03T10:05:00.000Z'),
			baseUrl.value,
			0,
			100,
			80,
			null,
			8,
			false,
			new ScanError(
				ScanErrorType.TYPE_VERIFICATION,
				'https://history.example.com/ledger.xdr.gz',
				'Wrong ledger hash'
			)
		);
		scanRepositoryMock.findLatestLimited.mockResolvedValue([scan]);

		const result = await getArchiveScans.execute({ limit: 10 });

		expect(result.isOk()).toBe(true);
		expect(result._unsafeUnwrap()).toMatchObject({
			generatedAt: '2026-07-03T12:00:00.000Z',
			limit: 10,
			count: 1,
			scans: [
				{
					url: 'https://history.example.com',
					latestVerifiedLedger: 79,
					hasError: true,
					errorMessage: 'Wrong ledger hash'
				}
			]
		});
		expect(scanRepositoryMock.findLatestLimited).toHaveBeenCalledWith(10);
	});

	it('should default and cap limits', async () => {
		scanRepositoryMock.findLatestLimited.mockResolvedValue([]);

		await getArchiveScans.execute();
		await getArchiveScans.execute({ limit: 200 });

		expect(scanRepositoryMock.findLatestLimited).toHaveBeenNthCalledWith(1, 50);
		expect(scanRepositoryMock.findLatestLimited).toHaveBeenNthCalledWith(
			2,
			100
		);
	});

	it('should log and return repository errors', async () => {
		const error = new Error('database unavailable');
		scanRepositoryMock.findLatestLimited.mockRejectedValue(error);

		const result = await getArchiveScans.execute();

		expect(result.isErr()).toBe(true);
		expect(result._unsafeUnwrapErr()).toBe(error);
		expect(exceptionLoggerMock.captureException).toHaveBeenCalledWith(error);
	});
});
