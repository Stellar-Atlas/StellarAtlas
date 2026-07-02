import { Container } from 'inversify';
import Kernel from '@core/infrastructure/Kernel.js';
import TypeOrmOrganizationSnapShotRepository from '../TypeOrmOrganizationSnapShotRepository.js';
import Organization from '@network-scan/domain/organization/Organization.js';
import { ConfigMock } from '@core/config/__mocks__/configMock.js';
import { NETWORK_TYPES } from '@network-scan/infrastructure/di/di-types.js';
import { createDummyOrganizationId } from '@network-scan/domain/organization/__fixtures__/createDummyOrganizationId.js';
import { TypeOrmOrganizationRepository } from '../TypeOrmOrganizationRepository.js';

describe('test queries', () => {
	let container: Container;
	let kernel: Kernel;
	let organizationSnapShotRepository: TypeOrmOrganizationSnapShotRepository;
	let organizationRepository: TypeOrmOrganizationRepository;
	jest.setTimeout(60000); //slow integration tests

	beforeEach(async () => {
		kernel = await Kernel.getInstance(new ConfigMock());
		container = kernel.container;
		organizationSnapShotRepository = container.get(
			NETWORK_TYPES.OrganizationSnapshotRepository
		);
		organizationRepository = container.get(
			NETWORK_TYPES.OrganizationRepository
		);
	});

	afterEach(async () => {
		await kernel.close();
	});

	test('findLatest, distinct on organizationId', async () => {
		const time = new Date('2020-01-01');
		const organization = Organization.create(
			createDummyOrganizationId(),
			'home',
			time
		);

		const organization2 = Organization.create(
			createDummyOrganizationId(),
			'home2',
			time
		);

		await organizationRepository.save([organization, organization2], time);

		const updateTime = new Date('2021-01-01');
		organization2.updateDescription('nice!', updateTime);
		await organizationRepository.save([organization2], updateTime);

		const latest = await organizationSnapShotRepository.findLatest();
		expect(latest.length).toEqual(2);
	});

	test('findLatestOrganizationId', async () => {
		const time = new Date('2020-01-01');
		const organization = Organization.create(
			createDummyOrganizationId(),
			'home',
			time
		);
		organization.updateName('home2', new Date('2020-01-02'));
		organization.updateUrl('home3', new Date('2020-01-03'));

		const organization2 = Organization.create(
			createDummyOrganizationId(),
			'home2',
			time
		);

		await organizationRepository.save([organization, organization2], time);

		const latest =
			await organizationSnapShotRepository.findLatestByOrganizationId(
				organization.organizationId
			);
		expect(latest.length).toEqual(3);
		expect(
			latest.filter((snapshot) =>
				snapshot.organization.organizationId.equals(organization.organizationId)
			).length
		).toEqual(3);
	});
});
