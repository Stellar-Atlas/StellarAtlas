import { mock, MockProxy } from 'jest-mock-extended';
import type { Config } from '@core/config/Config.js';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
import type { HistoryArchiveObjectRepository } from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveObjectRepository.js';
import { Scan } from '@history-scan-coordinator/domain/scan/Scan.js';
import type { ScanRepository } from '@history-scan-coordinator/domain/scan/ScanRepository.js';
import type { NetworkScanRepository } from '@network-scan/domain/network/scan/NetworkScanRepository.js';
import { Url } from 'http-helper';
import { GetDataFreshnessStatus } from '../GetDataFreshnessStatus.js';

describe('GetDataFreshnessStatus', () => {
	let networkScanRepositoryMock: MockProxy<NetworkScanRepository>;
	let objectRepositoryMock: MockProxy<HistoryArchiveObjectRepository>;
	let scanRepositoryMock: MockProxy<ScanRepository>;
	let exceptionLoggerMock: MockProxy<ExceptionLogger>;
	let configMock: MockProxy<Config>;
	let getDataFreshnessStatus: GetDataFreshnessStatus;

	beforeEach(() => {
		jest.useFakeTimers().setSystemTime(new Date('2026-07-03T12:00:00.000Z'));
		networkScanRepositoryMock = mock<NetworkScanRepository>();
		objectRepositoryMock = mock<HistoryArchiveObjectRepository>();
		objectRepositoryMock.findLatestActivityAt.mockResolvedValue(null);
		scanRepositoryMock = mock<ScanRepository>();
		scanRepositoryMock.findLatestLimited.mockResolvedValue([]);
		exceptionLoggerMock = mock<ExceptionLogger>();
		configMock = mock<Config>();
		configMock.networkScanLoopIntervalMs = 3 * 60 * 1000;
		configMock.crawlerConfig = {
			maxCrawlTime: 30 * 60 * 1000
		} as Config['crawlerConfig'];
		getDataFreshnessStatus = new GetDataFreshnessStatus(
			networkScanRepositoryMock,
			objectRepositoryMock,
			scanRepositoryMock,
			configMock,
			exceptionLoggerMock
		);
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	it('should expose latest network scan and archive object activity', async () => {
		networkScanRepositoryMock.findLatestSuccessfulScanTime.mockResolvedValue(
			new Date('2026-07-03T11:45:00.000Z')
		);
		objectRepositoryMock.findLatestActivityAt.mockResolvedValue(
			new Date('2026-07-03T11:50:00.000Z')
		);
		scanRepositoryMock.findLatestLimited.mockResolvedValue([
			createLegacyScan(new Date('2026-07-03T11:40:00.000Z'))
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
			archiveEvidence: {
				status: 'ok',
				latestAt: '2026-07-03T11:50:00.000Z',
				ageMs: 10 * 60 * 1000,
				staleAfterMs: 6 * 60 * 60 * 1000,
				drivesPlatformStatus: false,
				drivesRuntimeHealth: false,
				source: 'archive_object_evidence'
			},
			archiveScan: {
				status: 'ok',
				latestAt: '2026-07-03T11:40:00.000Z',
				ageMs: 20 * 60 * 1000,
				staleAfterMs: 6 * 60 * 60 * 1000,
				drivesPlatformStatus: false,
				drivesRuntimeHealth: false,
				source: 'legacy_range_scan',
				deprecated: true,
				historical: true
			}
		});
		expect(objectRepositoryMock.findLatestActivityAt).toHaveBeenCalledTimes(1);
		expect(scanRepositoryMock.findLatestLimited).toHaveBeenCalledWith(1);
	});

	it('keeps historical range and object evidence freshness out of platform status', async () => {
		networkScanRepositoryMock.findLatestSuccessfulScanTime.mockResolvedValue(
			new Date('2026-07-03T11:45:00.000Z')
		);
		objectRepositoryMock.findLatestActivityAt.mockResolvedValue(
			new Date('2026-07-03T02:00:00.000Z')
		);
		scanRepositoryMock.findLatestLimited.mockResolvedValue([
			createLegacyScan(new Date('2026-07-01T12:00:00.000Z'))
		]);

		const result = await getDataFreshnessStatus.execute();

		expect(result.isOk()).toBe(true);
		expect(result._unsafeUnwrap().status).toBe('ok');
		expect(result._unsafeUnwrap().archiveScan).toEqual({
			status: 'degraded',
			latestAt: '2026-07-01T12:00:00.000Z',
			ageMs: 48 * 60 * 60 * 1000,
			staleAfterMs: 6 * 60 * 60 * 1000,
			drivesPlatformStatus: false,
			drivesRuntimeHealth: false,
			source: 'legacy_range_scan',
			deprecated: true,
			historical: true
		});
		expect(result._unsafeUnwrap().archiveEvidence.status).toBe('degraded');
	});

	it('should degrade when network scan freshness exceeds policy', async () => {
		networkScanRepositoryMock.findLatestSuccessfulScanTime.mockResolvedValue(
			new Date('2026-07-03T10:00:00.000Z')
		);
		objectRepositoryMock.findLatestActivityAt.mockResolvedValue(
			new Date('2026-07-03T11:50:00.000Z')
		);

		const result = await getDataFreshnessStatus.execute();

		expect(result.isOk()).toBe(true);
		expect(result._unsafeUnwrap().status).toBe('degraded');
		expect(result._unsafeUnwrap().networkScan.status).toBe('degraded');
	});

	it('should mark missing persisted scan data unavailable', async () => {
		networkScanRepositoryMock.findLatestSuccessfulScanTime.mockResolvedValue(
			undefined
		);
		objectRepositoryMock.findLatestActivityAt.mockResolvedValue(null);

		const result = await getDataFreshnessStatus.execute();

		expect(result.isOk()).toBe(true);
		expect(result._unsafeUnwrap()).toMatchObject({
			status: 'unavailable',
			networkScan: { status: 'unavailable', latestAt: null, ageMs: null },
			archiveEvidence: {
				status: 'unavailable',
				latestAt: null,
				ageMs: null,
				drivesRuntimeHealth: false
			},
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

function createLegacyScan(endDate: Date): Scan {
	const archiveUrl = Url.create('https://legacy-archive.example');
	if (archiveUrl.isErr()) throw archiveUrl.error;
	return new Scan(
		endDate,
		new Date(endDate.getTime() - 60_000),
		endDate,
		archiveUrl.value,
		0,
		63,
		63
	);
}
