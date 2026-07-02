import Kernel from '@core/infrastructure/Kernel.js';
import { ConfigMock } from '@core/config/__mocks__/configMock.js';
import { mock } from 'jest-mock-extended';
import { GetLatestOrganizationSnapshots } from '../GetLatestOrganizationSnapshots.js';
import type { OrganizationSnapShotRepository } from '@network-scan/domain/organization/OrganizationSnapShotRepository.js';
import { NETWORK_TYPES } from '@network-scan/infrastructure/di/di-types.js';

let kernel: Kernel;
jest.setTimeout(60000); //slow integration tests
beforeAll(async () => {
	kernel = await Kernel.getInstance(new ConfigMock());
});

afterAll(async () => {
	await kernel.close();
});

it('should fetch latest snapshots', async () => {
	const repo = mock<OrganizationSnapShotRepository>();
	repo.findLatest.mockResolvedValue([]);
	kernel.container
		.rebind(NETWORK_TYPES.OrganizationSnapshotRepository)
		.toConstantValue(repo);

	const useCase = kernel.container.get(GetLatestOrganizationSnapshots);
	const result = await useCase.execute({
		at: new Date()
	});
	expect(result.isOk()).toBe(true);
	if (!result.isOk()) return;
});
