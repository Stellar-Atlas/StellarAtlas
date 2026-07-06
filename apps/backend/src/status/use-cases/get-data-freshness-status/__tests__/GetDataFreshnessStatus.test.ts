import { mock, MockProxy } from 'jest-mock-extended';
import type { Config } from '@core/config/Config.js';
import { Url } from '@core/domain/Url.js';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
import { Scan } from '@history-scan-coordinator/domain/scan/Scan.js';
import type { ScanRepository } from '@history-scan-coordinator/domain/scan/ScanRepository.js';
import type { NetworkScanRepository } from '@network-scan/domain/network/scan/NetworkScanRepository.js';
import { GetDataFreshnessStatus } from '../GetDataFreshnessStatus.js';

describe('GetDataFreshnessStatus', () => {
	let networkScanRepositoryMock: MockProxy<NetworkScanRepository>;
	let scanRepositoryMock: MockProxy<ScanRepository>;
	let exceptionLoggerMock: MockProxy<ExceptionLogger>;
	let configMock: MockProxy<Config>;
	let getDataFreshnessStatus: GetDataFreshnessStatus;

	beforeEach(() => {
		jest.useFakeTimers().setSystemTime(new Date('2026-07-03T12:00:00.000Z'));
		networkScanRepositoryMock = mock<NetworkScanRepository>();
		scanRepositoryMock = mock<ScanRepository>();
		exceptionLoggerMock = mock<ExceptionLogger>();
		configMock = mock<Config>();
		configMock.networkScanLoopIntervalMs = 3 * 60 * 1000;
		configMock.crawlerConfig = {
			maxCrawlTime: 30 * 60 * 1000
		} as Config['crawlerConfig'];
		getDataFreshnessStatus = new GetDataFreshnessStatus(
			networkScanRepositoryMock,
			scanRepositoryMock,
			configMock,
			exceptionLoggerMock
		);
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	it('should expose latest persisted network and archive freshness', async () => {
		networkScanRepositoryMock.findLatestSuccessfulScanTime.mockResolvedValue(
			new Date('2026-07-03T11:45:00.000Z')
		);
		scanRepositoryMock.findLatestLimited.mockResolvedValue([
			createScan(new Date('2026-07-03T11:50:00.000Z'))
		]);

		const result = await getDataFreshnessStatus.execute();

		expect(result.isOk()).toBe(true);
		expect(result._unsafeUnwrap()).toEqual({
			generatedAt: '2026-07-03T12:00:00.000Z',
			status: 'ok',
			networkScan: {
				status: 'ok',
				latestAt: '2026-07-03T11:45:00.000Z',
				ageMs: 15 * 60 * 1000,
				staleAfterMs: 60 * 60 * 1000
			},
			archiveScan: {
				status: 'ok',
				latestAt: '2026-07-03T11:50:00.000Z',
				ageMs: 10 * 60 * 1000,
				staleAfterMs: 6 * 60 * 60 * 1000
			}
		});
		expect(scanRepositoryMock.findLatestLimited).toHaveBeenCalledWith(1);
	});

	it('should keep headline freshness tied to network scans when archive scan evidence is stale', async () => {
		networkScanRepositoryMock.findLatestSuccessfulScanTime.mockResolvedValue(
			new Date('2026-07-03T11:45:00.000Z')
		);
		scanRepositoryMock.findLatestLimited.mockResolvedValue([
			createScan(new Date('2026-07-03T02:00:00.000Z'))
		]);

		const result = await getDataFreshnessStatus.execute();

		expect(result.isOk()).toBe(true);
		expect(result._unsafeUnwrap().status).toBe('ok');
		expect(result._unsafeUnwrap().archiveScan).toEqual({
			status: 'degraded',
			latestAt: '2026-07-03T02:00:00.000Z',
			ageMs: 10 * 60 * 60 * 1000,
			staleAfterMs: 6 * 60 * 60 * 1000
		});
	});

	it('should degrade when network scan freshness exceeds policy', async () => {
		networkScanRepositoryMock.findLatestSuccessfulScanTime.mockResolvedValue(
			new Date('2026-07-03T10:00:00.000Z')
		);
		scanRepositoryMock.findLatestLimited.mockResolvedValue([
			createScan(new Date('2026-07-03T11:50:00.000Z'))
		]);

		const result = await getDataFreshnessStatus.execute();

		expect(result.isOk()).toBe(true);
		expect(result._unsafeUnwrap().status).toBe('degraded');
		expect(result._unsafeUnwrap().networkScan.status).toBe('degraded');
	});

	it('should mark missing persisted scan data unavailable', async () => {
		networkScanRepositoryMock.findLatestSuccessfulScanTime.mockResolvedValue(
			undefined
		);
		scanRepositoryMock.findLatestLimited.mockResolvedValue([]);

		const result = await getDataFreshnessStatus.execute();

		expect(result.isOk()).toBe(true);
		expect(result._unsafeUnwrap()).toMatchObject({
			status: 'unavailable',
			networkScan: { status: 'unavailable', latestAt: null, ageMs: null },
			archiveScan: { status: 'unavailable', latestAt: null, ageMs: null }
		});
	});

	it('should log and return repository errors', async () => {
		const error = new Error('database unavailable');
		networkScanRepositoryMock.findLatestSuccessfulScanTime.mockRejectedValue(
			error
		);

		const result = await getDataFreshnessStatus.execute();

		expect(result.isErr()).toBe(true);
		expect(result._unsafeUnwrapErr()).toBe(error);
		expect(exceptionLoggerMock.captureException).toHaveBeenCalledWith(error);
	});
});

function createScan(endDate: Date): Scan {
	const url = Url.create('https://history.example.com')._unsafeUnwrap();
	return new Scan(
		new Date('2026-07-03T11:00:00.000Z'),
		new Date('2026-07-03T11:00:00.000Z'),
		endDate,
		url,
		0,
		null
	);
}
