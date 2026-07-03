import { Container } from 'inversify';
import Kernel from '@core/infrastructure/Kernel.js';
import { TypeOrmNetworkMeasurementDayRepository } from '../TypeOrmNetworkMeasurementDayRepository.js';
import NetworkMeasurementDay from '@network-scan/domain/network/NetworkMeasurementDay.js';
import NetworkMeasurement from '@network-scan/domain/network/NetworkMeasurement.js';
import NetworkScan from '@network-scan/domain/network/scan/NetworkScan.js';
import { TypeOrmNetworkScanRepository } from '../TypeOrmNetworkScanRepository.js';
import { ConfigMock } from '@core/config/__mocks__/configMock.js';
import { NETWORK_TYPES } from '@network-scan/infrastructure/di/di-types.js';
import { NetworkId } from '@network-scan/domain/network/NetworkId.js';

describe('test queries', () => {
	let container: Container;
	let kernel: Kernel;
	let networkMeasurementDayRepository: TypeOrmNetworkMeasurementDayRepository;
	jest.setTimeout(60000); //slow integration tests

	beforeEach(async () => {
		kernel = await Kernel.getInstance(new ConfigMock());
		container = kernel.container;
		networkMeasurementDayRepository = container.get(
			NETWORK_TYPES.NetworkMeasurementDayRepository
		);
	});

	afterEach(async () => {
		await kernel.close();
	});

	test('findBetween', async () => {
		const measurement = new NetworkMeasurementDay();
		measurement.time = new Date(Date.UTC(2020, 0, 2));
		measurement.hasQuorumIntersectionCount = 5;
		await networkMeasurementDayRepository.save([measurement]);
		const from = new Date(Date.UTC(2020, 0, 1));
		const to = new Date(Date.UTC(2020, 0, 3));
		const measurements = await networkMeasurementDayRepository.findBetween(
			new NetworkId('public'),
			from,
			to
		);
		expect(measurements.length).toEqual(3);
		expect(measurements[0].time).toEqual(new Date(Date.UTC(2020, 0, 1)));
		expect(measurements[0].hasQuorumIntersectionCount).toEqual(0);
		expect(measurements[1].time).toEqual(new Date(Date.UTC(2020, 0, 2)));
		expect(measurements[1].hasQuorumIntersectionCount).toEqual(5);
		expect(measurements[2].time).toEqual(new Date(Date.UTC(2020, 0, 3)));
		expect(measurements[2].hasQuorumIntersectionCount).toEqual(0);
	});

	test('rollup', async () => {
		const scan1 = new NetworkScan(new Date(Date.UTC(2020, 0, 3, 0)));
		scan1.completed = true;
		const scan2 = new NetworkScan(new Date(Date.UTC(2020, 0, 3, 1)));
		scan2.completed = true;
		const scan3 = new NetworkScan(new Date(Date.UTC(2020, 0, 3, 2)));
		scan3.completed = true;
		scan1.id = 1;
		scan2.id = 2;
		scan3.id = 3;
		const scanRepo = container.get<TypeOrmNetworkScanRepository>(
			NETWORK_TYPES.NetworkScanRepository
		);
		const measurement1 = new NetworkMeasurement(scan1.time);
		scan1.measurement = measurement1;
		const measurement2 = new NetworkMeasurement(scan2.time);
		scan2.measurement = measurement2;
		const measurement3 = new NetworkMeasurement(scan3.time);
		scan3.measurement = measurement3;

		for (const key of Object.keys(measurement1)) {
			if (key !== 'id' && key !== 'time') {
				// @ts-ignore
				measurement1[key] = 1;
				// @ts-ignore
				measurement2[key] = 1;
				// @ts-ignore
				measurement3[key] = 1;
			}
		}
		measurement3.topTierSize = 2;
		await scanRepo.save([scan1, scan2]);

		await networkMeasurementDayRepository.rollup(1, 2);
		let measurements = await networkMeasurementDayRepository.findBetween(
			new NetworkId('public'),
			new Date(Date.UTC(2020, 0, 3)),
			new Date(Date.UTC(2020, 0, 3))
		);
		expect(measurements.length).toEqual(1);
		expect(measurements[0].crawlCount).toEqual(2);
		expect(measurements[0].nrOfActiveWatchersSum).toEqual(2);
		expect(measurements[0].minBlockingSetFilteredMax).toEqual(1);

		await scanRepo.save([scan3]);
		await networkMeasurementDayRepository.rollup(3, 3);
		measurements = await networkMeasurementDayRepository.findBetween(
			new NetworkId('public'),
			new Date(Date.UTC(2020, 0, 3)),
			new Date(Date.UTC(2020, 0, 3))
		);
		expect(measurements.length).toEqual(1);
		expect(measurements[0].crawlCount).toEqual(3);
		expect(measurements[0].nrOfActiveWatchersSum).toEqual(3);
		expect(measurements[0].minBlockingSetFilteredMax).toEqual(1);
		expect(measurements[0].topTierMin).toEqual(1);
		expect(measurements[0].topTierMax).toEqual(2);

		await networkMeasurementDayRepository.rollup(3, 3);
		measurements = await networkMeasurementDayRepository.findBetween(
			new NetworkId('public'),
			new Date(Date.UTC(2020, 0, 3)),
			new Date(Date.UTC(2020, 0, 3))
		);
		expect(measurements[0].crawlCount).toEqual(3);
		expect(measurements[0].nrOfActiveWatchersSum).toEqual(3);
	});

	test('findScanRollupSummary', async () => {
		const scanRepo = container.get<TypeOrmNetworkScanRepository>(
			NETWORK_TYPES.NetworkScanRepository
		);
		await scanRepo.save([
			createNetworkScan(new Date(Date.UTC(2020, 0, 1, 1)), true, 1),
			createNetworkScan(new Date(Date.UTC(2020, 0, 2, 1)), true, 2),
			createNetworkScan(new Date(Date.UTC(2020, 0, 2, 2)), true, 3),
			createNetworkScan(new Date(Date.UTC(2020, 0, 3, 1)), false, 4)
		]);

		const matchingRollup = new NetworkMeasurementDay();
		matchingRollup.time = new Date(Date.UTC(2020, 0, 1));
		matchingRollup.crawlCount = 1;
		const mismatchedRollup = new NetworkMeasurementDay();
		mismatchedRollup.time = new Date(Date.UTC(2020, 0, 3));
		mismatchedRollup.crawlCount = 2;
		await networkMeasurementDayRepository.save([
			matchingRollup,
			mismatchedRollup
		]);

		const summary = await networkMeasurementDayRepository.findScanRollupSummary(
			new Date(Date.UTC(2020, 0, 1)),
			new Date(Date.UTC(2020, 0, 4))
		);

		expect(summary).toEqual([
			{
				day: new Date(Date.UTC(2020, 0, 1)),
				rawCompletedScans: 1,
				rollupCrawlCount: 1
			},
			{
				day: new Date(Date.UTC(2020, 0, 2)),
				rawCompletedScans: 2,
				rollupCrawlCount: null
			},
			{
				day: new Date(Date.UTC(2020, 0, 3)),
				rawCompletedScans: 0,
				rollupCrawlCount: 2
			}
		]);
	});
});

function createNetworkScan(
	time: Date,
	completed: boolean,
	activeWatchers: number
): NetworkScan {
	const scan = new NetworkScan(time);
	scan.latestLedger = BigInt(activeWatchers);
	scan.completed = completed;

	const measurement = new NetworkMeasurement(scan.time);
	measurement.nrOfActiveWatchers = activeWatchers;
	scan.measurement = measurement;

	return scan;
}
