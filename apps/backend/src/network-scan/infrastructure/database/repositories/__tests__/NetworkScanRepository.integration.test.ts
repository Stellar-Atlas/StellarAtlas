import { Container } from 'inversify';
import Kernel from '@core/infrastructure/Kernel.js';
import { TypeOrmNetworkScanRepository } from '../TypeOrmNetworkScanRepository.js';
import NetworkScan from '@network-scan/domain/network/scan/NetworkScan.js';
import { ConfigMock } from '@core/config/__mocks__/configMock.js';
import { NETWORK_TYPES } from '@network-scan/infrastructure/di/di-types.js';
import NetworkMeasurement from '@network-scan/domain/network/NetworkMeasurement.js';

describe('NetworkScanRepository', () => {
	let container: Container;
	let kernel: Kernel;
	let networkScanRepository: TypeOrmNetworkScanRepository;
	jest.setTimeout(60000); //slow integration tests

	beforeEach(async () => {
		kernel = await Kernel.getInstance(new ConfigMock());
		container = kernel.container;
		networkScanRepository = container.get<TypeOrmNetworkScanRepository>(
			NETWORK_TYPES.NetworkScanRepository
		);
	});

	afterEach(async () => {
		await kernel.close();
	});

	test('findAt', async function () {
		const setup = await setupTwoScans();

		const fetchedNetworkScan = await networkScanRepository.findAt(
			setup.previousNetworkScan.time
		);
		expect(fetchedNetworkScan).toBeInstanceOf(NetworkScan);
		if (!fetchedNetworkScan) return;

		expect(fetchedNetworkScan.latestLedger).toEqual(
			setup.previousNetworkScan.latestLedger
		);
		expect(typeof fetchedNetworkScan.latestLedger).toEqual('bigint');
		expect(fetchedNetworkScan.latestLedgerCloseTime?.getTime()).toEqual(
			setup.previousNetworkScan.time.getTime()
		);
		expect(fetchedNetworkScan.measurement).toBeInstanceOf(NetworkMeasurement);
		expect(fetchedNetworkScan.measurement?.nrOfActiveWatchers).toEqual(1);
	});

	test('findPrevious', async function () {
		const setup = await setupTwoScans();

		const fetchedNetworkScan = await networkScanRepository.findPreviousAt(
			setup.latestNetworkScan.time
		);
		expect(fetchedNetworkScan).toBeInstanceOf(NetworkScan);
		if (!fetchedNetworkScan) return;

		expect(fetchedNetworkScan.time.getTime()).toEqual(
			setup.previousNetworkScan.time.getTime()
		);

		expect(fetchedNetworkScan.measurement).toBeInstanceOf(NetworkMeasurement);
		expect(fetchedNetworkScan.measurement?.nrOfActiveWatchers).toEqual(1);
	});

	test('findLatest', async function () {
		const setup = await setupTwoScans();

		const fetchedNetworkScan = await networkScanRepository.findLatest();
		expect(fetchedNetworkScan).toBeInstanceOf(NetworkScan);
		if (!fetchedNetworkScan) return;

		expect(fetchedNetworkScan.time.getTime()).toEqual(
			setup.latestNetworkScan.time.getTime()
		);

		expect(fetchedNetworkScan.measurement).toBeInstanceOf(NetworkMeasurement);
		expect(fetchedNetworkScan.measurement?.nrOfActiveWatchers).toEqual(2);
	});

	test('findLatestSuccessfulScanTime', async function () {
		const setup = await setupTwoScans();

		const scanTime = await networkScanRepository.findLatestSuccessfulScanTime();
		expect(scanTime).toBeInstanceOf(Date);
		if (!scanTime) return;

		expect(scanTime.getTime()).toEqual(setup.latestNetworkScan.time.getTime());
	});

	test('findScanSummary', async function () {
		const completedScan = createNetworkScan(
			new Date('2020-01-01T00:00:00.000Z'),
			true,
			1
		);
		const incompleteScan = createNetworkScan(
			new Date('2020-01-01T00:03:00.000Z'),
			false,
			2
		);
		const outsideWindowScan = createNetworkScan(
			new Date('2020-01-02T00:00:00.000Z'),
			true,
			3
		);
		await networkScanRepository.save([
			completedScan,
			incompleteScan,
			outsideWindowScan
		]);

		const summary = await networkScanRepository.findScanSummary(
			new Date('2020-01-01T00:00:00.000Z'),
			new Date('2020-01-01T23:59:59.999Z')
		);

		expect(summary).toEqual({
			totalScans: 2,
			completedScans: 1,
			latestScanAt: incompleteScan.time,
			latestCompletedScanAt: completedScan.time
		});
	});

	async function setupTwoScans() {
		const previousNetworkScan = new NetworkScan(new Date('2020-01-01'));
		previousNetworkScan.latestLedger = BigInt(100);
		previousNetworkScan.latestLedgerCloseTime = previousNetworkScan.time;
		previousNetworkScan.completed = true;
		const previousMeasurement = new NetworkMeasurement(
			previousNetworkScan.time
		);
		previousMeasurement.nrOfActiveWatchers = 1;
		previousNetworkScan.measurement = previousMeasurement;

		const latestNetworkScan = new NetworkScan(new Date('2020-01-02'));
		latestNetworkScan.latestLedger = BigInt(200);
		latestNetworkScan.completed = true;
		const latestMeasurement = new NetworkMeasurement(latestNetworkScan.time);
		latestMeasurement.nrOfActiveWatchers = 2;
		latestNetworkScan.measurement = latestMeasurement;

		await networkScanRepository.saveOne(previousNetworkScan);
		await networkScanRepository.saveOne(latestNetworkScan);

		return {
			previousNetworkScan,
			latestNetworkScan
		};
	}
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
