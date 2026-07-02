import { Container } from 'inversify';
import Kernel from '@core/infrastructure/Kernel.js';
import { ConfigMock } from '@core/config/__mocks__/configMock.js';
import { NETWORK_TYPES } from '@network-scan/infrastructure/di/di-types.js';
import { TypeOrmOrganizationMeasurementDayRepository } from '../TypeOrmOrganizationMeasurementDayRepository.js';
import type { OrganizationRepository } from '@network-scan/domain/organization/OrganizationRepository.js';
import Organization from '@network-scan/domain/organization/Organization.js';
import { createDummyOrganizationId } from '@network-scan/domain/organization/__fixtures__/createDummyOrganizationId.js';
import OrganizationMeasurementDay from '@network-scan/domain/organization/OrganizationMeasurementDay.js';
import NetworkScan from '@network-scan/domain/network/scan/NetworkScan.js';
import NetworkMeasurement from '@network-scan/domain/network/NetworkMeasurement.js';
import type { NetworkScanRepository } from '@network-scan/domain/network/scan/NetworkScanRepository.js';
import type { OrganizationMeasurementRepository } from '@network-scan/domain/organization/OrganizationMeasurementRepository.js';
import OrganizationMeasurement from '@network-scan/domain/organization/OrganizationMeasurement.js';

describe('test queries', () => {
	let container: Container;
	let kernel: Kernel;
	let repo: TypeOrmOrganizationMeasurementDayRepository;
	let versionedOrganizationRepository: OrganizationRepository;
	jest.setTimeout(60000); //slow integration tests

	beforeEach(async () => {
		kernel = await Kernel.getInstance(new ConfigMock());
		container = kernel.container;
		repo = container.get(NETWORK_TYPES.OrganizationMeasurementDayRepository);
		versionedOrganizationRepository = container.get(
			NETWORK_TYPES.OrganizationRepository
		);
	});

	afterEach(async () => {
		await kernel.close();
	});

	test('findBetween', async () => {
		const time = new Date();
		const idA = Organization.create(
			createDummyOrganizationId(),
			'domain1',
			time
		);
		const idB = Organization.create(
			createDummyOrganizationId(),
			'domain2',
			time
		);
		await versionedOrganizationRepository.save([idA, idB], time);
		await repo.save([
			new OrganizationMeasurementDay('12/12/2020', idA),
			new OrganizationMeasurementDay('12/12/2020', idB),
			new OrganizationMeasurementDay('12/13/2020', idA),
			new OrganizationMeasurementDay('12/13/2020', idB)
		]);

		const measurements = await repo.findBetween(
			idA.organizationId,
			new Date('12/12/2020'),
			new Date('12/13/2020')
		);
		expect(measurements.length).toEqual(2);
	});

	test('findXDaysAverageAt', async () => {
		const time = new Date();
		const idA = Organization.create(
			createDummyOrganizationId(),
			'domain',
			time
		);
		await versionedOrganizationRepository.save([idA], time);
		const a = new OrganizationMeasurementDay('12/12/2020', idA);
		a.crawlCount = 2;
		a.isSubQuorumAvailableCount = 2;
		const b = new OrganizationMeasurementDay('12/13/2020', idA);
		b.crawlCount = 2;
		b.isSubQuorumAvailableCount = 2;
		await repo.save([a, b]);

		const averages = await repo.findXDaysAverageAt(new Date('12/13/2020'), 2);
		expect(averages.length).toEqual(1);
		expect(averages[0].isSubQuorumAvailableAvg).toEqual(100);
		expect(averages[0].organizationId).toEqual(idA.organizationId.value);
	});

	test('rollup is idempotent for affected days', async () => {
		const scanRepository = container.get<NetworkScanRepository>(
			NETWORK_TYPES.NetworkScanRepository
		);
		const measurementRepository =
			container.get<OrganizationMeasurementRepository>(
				NETWORK_TYPES.OrganizationMeasurementRepository
			);
		const scanTime1 = new Date(Date.UTC(2020, 0, 3, 0));
		const scanTime2 = new Date(Date.UTC(2020, 0, 3, 1));
		const organization = Organization.create(
			createDummyOrganizationId(),
			'domain',
			scanTime1
		);
		await versionedOrganizationRepository.save([organization], scanTime1);

		const scan1 = new NetworkScan(scanTime1);
		scan1.id = 1;
		scan1.completed = true;
		scan1.measurement = new NetworkMeasurement(scanTime1);
		const measurement1 = new OrganizationMeasurement(scanTime1, organization);
		measurement1.isSubQuorumAvailable = true;
		measurement1.index = 1;
		await scanRepository.save([scan1]);
		await measurementRepository.save([measurement1]);

		await repo.rollup(1, 1);
		let measurements = await repo.findBetween(
			organization.organizationId,
			scanTime1,
			scanTime1
		);
		expect(measurements[0].crawlCount).toEqual(1);
		expect(measurements[0].isSubQuorumAvailableCount).toEqual(1);

		const scan2 = new NetworkScan(scanTime2);
		scan2.id = 2;
		scan2.completed = true;
		scan2.measurement = new NetworkMeasurement(scanTime2);
		const measurement2 = new OrganizationMeasurement(scanTime2, organization);
		measurement2.isSubQuorumAvailable = false;
		measurement2.index = 2;
		await scanRepository.save([scan2]);
		await measurementRepository.save([measurement2]);

		await repo.rollup(2, 2);
		await repo.rollup(2, 2);
		measurements = await repo.findBetween(
			organization.organizationId,
			scanTime1,
			scanTime1
		);
		expect(measurements[0].crawlCount).toEqual(2);
		expect(measurements[0].isSubQuorumAvailableCount).toEqual(1);
		expect(measurements[0].indexSum).toEqual(3);
	});
});
