import { mock, MockProxy } from 'jest-mock-extended';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
import NetworkMeasurement from '@network-scan/domain/network/NetworkMeasurement.js';
import NetworkScan from '@network-scan/domain/network/scan/NetworkScan.js';
import type { NetworkScanRepository } from '@network-scan/domain/network/scan/NetworkScanRepository.js';
import { GetFbasAnalysis } from '../GetFbasAnalysis.js';

describe('GetFbasAnalysis', () => {
	let networkScanRepositoryMock: MockProxy<NetworkScanRepository>;
	let exceptionLoggerMock: MockProxy<ExceptionLogger>;
	let getFbasAnalysis: GetFbasAnalysis;

	beforeEach(() => {
		jest.useFakeTimers().setSystemTime(new Date('2026-07-03T12:00:00.000Z'));
		networkScanRepositoryMock = mock<NetworkScanRepository>();
		exceptionLoggerMock = mock<ExceptionLogger>();
		getFbasAnalysis = new GetFbasAnalysis(
			networkScanRepositoryMock,
			exceptionLoggerMock
		);
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	it('should expose aggregate FBAS metrics for a completed scan', async () => {
		networkScanRepositoryMock.findCompletedById.mockResolvedValue(
			makeNetworkScan()
		);

		const result = await getFbasAnalysis.execute({ scanId: 42 });

		expect(result.isOk()).toBe(true);
		expect(result._unsafeUnwrap()).toEqual({
			generatedAt: '2026-07-03T12:00:00.000Z',
			evidenceSelection: 'completed_network_scan_measurement',
			proofSetPersistence: 'not_persisted',
			scanId: 42,
			scanTime: '2026-07-03T11:56:00.000Z',
			latestLedger: '123456789',
			latestLedgerCloseTime: '2026-07-03T11:55:00.000Z',
			processedLedgers: [123456000, 123456789],
			summary: {
				nrOfActiveWatchers: 4,
				nrOfConnectableNodes: 8,
				nrOfActiveValidators: 7,
				nrOfActiveFullValidators: 6,
				nrOfActiveOrganizations: 5,
				transitiveQuorumSetSize: 9,
				hasTransitiveQuorumSet: true,
				topTierSize: 10,
				topTierOrgsSize: 3,
				hasSymmetricTopTier: false,
				hasQuorumIntersection: true,
				minBlockingSetSize: 2,
				minBlockingSetFilteredSize: 3,
				minBlockingSetOrgsSize: 4,
				minBlockingSetOrgsFilteredSize: 5,
				minBlockingSetCountrySize: 6,
				minBlockingSetCountryFilteredSize: 7,
				minBlockingSetISPSize: 8,
				minBlockingSetISPFilteredSize: 9,
				minSplittingSetSize: 11,
				minSplittingSetOrgsSize: 12,
				minSplittingSetCountrySize: 13,
				minSplittingSetISPSize: 14
			}
		});
		expect(networkScanRepositoryMock.findCompletedById).toHaveBeenCalledWith(
			42
		);
	});

	it('should return null when a completed scan analysis does not exist', async () => {
		networkScanRepositoryMock.findCompletedById.mockResolvedValue(undefined);

		const result = await getFbasAnalysis.execute({ scanId: 42 });

		expect(result.isOk()).toBe(true);
		expect(result._unsafeUnwrap()).toBeNull();
	});

	it('should reject invalid scan ids', async () => {
		const result = await getFbasAnalysis.execute({ scanId: 0 });

		expect(result.isErr()).toBe(true);
		expect(result._unsafeUnwrapErr().message).toBe(
			'scanId must be a positive 32-bit integer'
		);
		expect(networkScanRepositoryMock.findCompletedById).not.toHaveBeenCalled();
		expect(exceptionLoggerMock.captureException).not.toHaveBeenCalled();
	});

	it('should return an error when measurement evidence is missing', async () => {
		const scan = makeNetworkScan();
		scan.measurement = null;
		networkScanRepositoryMock.findCompletedById.mockResolvedValue(scan);

		const result = await getFbasAnalysis.execute({ scanId: 42 });

		expect(result.isErr()).toBe(true);
		expect(result._unsafeUnwrapErr().message).toBe(
			'Completed network scan measurement not found for scan 42'
		);
		expect(exceptionLoggerMock.captureException).toHaveBeenCalledWith(
			result._unsafeUnwrapErr()
		);
	});

	it('should log and return repository errors', async () => {
		const error = new Error('database unavailable');
		networkScanRepositoryMock.findCompletedById.mockRejectedValue(error);

		const result = await getFbasAnalysis.execute({ scanId: 42 });

		expect(result.isErr()).toBe(true);
		expect(result._unsafeUnwrapErr()).toBe(error);
		expect(exceptionLoggerMock.captureException).toHaveBeenCalledWith(error);
	});
});

function makeNetworkScan(): NetworkScan {
	const scan = new NetworkScan(new Date('2026-07-03T11:56:00.000Z'));
	scan.id = 42;
	scan.completed = true;
	scan.latestLedger = BigInt(123456789);
	scan.latestLedgerCloseTime = new Date('2026-07-03T11:55:00.000Z');
	scan.ledgers = [123456000, 123456789];
	scan.measurement = makeNetworkMeasurement(scan.time);

	return scan;
}

function makeNetworkMeasurement(time: Date): NetworkMeasurement {
	const measurement = new NetworkMeasurement(time);
	measurement.nrOfActiveWatchers = 4;
	measurement.nrOfConnectableNodes = 8;
	measurement.nrOfActiveValidators = 7;
	measurement.nrOfActiveFullValidators = 6;
	measurement.nrOfActiveOrganizations = 5;
	measurement.hasQuorumIntersection = true;
	measurement.hasTransitiveQuorumSet = true;
	measurement.transitiveQuorumSetSize = 9;
	measurement.hasSymmetricTopTier = false;
	measurement.topTierSize = 10;
	measurement.topTierOrgsSize = 3;
	measurement.minBlockingSetSize = 2;
	measurement.minBlockingSetFilteredSize = 3;
	measurement.minBlockingSetOrgsSize = 4;
	measurement.minBlockingSetOrgsFilteredSize = 5;
	measurement.minBlockingSetCountrySize = 6;
	measurement.minBlockingSetCountryFilteredSize = 7;
	measurement.minBlockingSetISPSize = 8;
	measurement.minBlockingSetISPFilteredSize = 9;
	measurement.minSplittingSetSize = 11;
	measurement.minSplittingSetOrgsSize = 12;
	measurement.minSplittingSetCountrySize = 13;
	measurement.minSplittingSetISPSize = 14;

	return measurement;
}
