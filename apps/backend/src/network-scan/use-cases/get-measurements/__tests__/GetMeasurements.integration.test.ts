import Kernel from '@core/infrastructure/Kernel.js';
import { ConfigMock } from '@core/config/__mocks__/configMock.js';
import { GetMeasurementsFactory } from '../GetMeasurementsFactory.js';
import NodeMeasurement from '@network-scan/domain/node/NodeMeasurement.js';
import OrganizationMeasurement from '@network-scan/domain/organization/OrganizationMeasurement.js';
import NetworkMeasurement from '@network-scan/domain/network/NetworkMeasurement.js';

let kernel: Kernel;
jest.setTimeout(60000); //slow integration tests
beforeAll(async () => {
	kernel = await Kernel.getInstance(new ConfigMock());
});

afterAll(async () => {
	await kernel.close();
});

it('should find class instance', async () => {
	const factory = kernel.container.get(GetMeasurementsFactory);
	expect(factory).toBeDefined();
});

it('should find measurements', async function () {
	const factory = kernel.container.get(GetMeasurementsFactory);
	const dto = {
		id: 'test',
		from: new Date('2020-01-01T00:00:00.000Z'),
		to: new Date('2020-01-01T00:00:00.000Z')
	};

	const nodeResult = await factory.createFor(NodeMeasurement).execute(dto);
	expect(nodeResult.isOk()).toBeTruthy();
	const organizationResult = await factory
		.createFor(OrganizationMeasurement)
		.execute(dto);
	expect(organizationResult.isOk()).toBeTruthy();
	const networkResult = await factory
		.createFor(NetworkMeasurement)
		.execute(dto);
	expect(networkResult.isOk()).toBeTruthy();
});
