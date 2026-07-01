import Kernel from '../../../../core/infrastructure/Kernel.js';
import { ConfigMock } from '../../../../core/config/__mocks__/configMock.js';
import { mock } from 'jest-mock-extended';
import { GetLatestNodeSnapshots } from '../GetLatestNodeSnapshots.js';
import type { NodeSnapShotRepository } from '../../../domain/node/NodeSnapShotRepository.js';
import { NETWORK_TYPES } from '../../../infrastructure/di/di-types.js';

let kernel: Kernel;
jest.setTimeout(60000); //slow integration tests
beforeAll(async () => {
	kernel = await Kernel.getInstance(new ConfigMock());
});

afterAll(async () => {
	await kernel.close();
});

it('should fetch latest node snapshots', async () => {
	const repo = mock<NodeSnapShotRepository>();
	repo.findLatest.mockResolvedValue([]);
	kernel.container
		.rebind(NETWORK_TYPES.NodeSnapshotRepository)
		.toConstantValue(repo);

	const useCase = kernel.container.get(GetLatestNodeSnapshots);
	const result = await useCase.execute({
		at: new Date()
	});
	expect(result.isOk()).toBe(true);
	if (!result.isOk()) return;
});
