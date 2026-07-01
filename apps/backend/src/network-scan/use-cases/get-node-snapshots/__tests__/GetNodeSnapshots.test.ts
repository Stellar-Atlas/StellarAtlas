import { mock } from 'jest-mock-extended';
import type { ExceptionLogger } from '../../../../core/services/ExceptionLogger.js';
import { GetNodeSnapshots } from '../GetNodeSnapshots.js';
import { ExceptionLoggerMock } from '../../../../core/services/__mocks__/ExceptionLoggerMock.js';
import { createDummyPublicKeyString } from '../../../domain/node/__fixtures__/createDummyPublicKey.js';
import type { NodeSnapShotRepository } from '../../../domain/node/NodeSnapShotRepository.js';

it('should capture and return errors', async function () {
	const repo = mock<NodeSnapShotRepository>();
	repo.findLatest.mockRejectedValue(new Error('test'));
	const exceptionLogger = mock<ExceptionLogger>();
	const useCase = new GetNodeSnapshots(repo, exceptionLogger);
	const result = await useCase.execute({
		at: new Date(),
		publicKey: createDummyPublicKeyString()
	});
	expect(result.isErr()).toBe(true);
	expect(exceptionLogger.captureException).toHaveBeenCalledTimes(1);
});

it('should fetch latest node snapshots', async () => {
	const repo = mock<NodeSnapShotRepository>();
	repo.findLatestByPublicKey.mockResolvedValue([]);

	const useCase = new GetNodeSnapshots(repo, new ExceptionLoggerMock());
	const result = await useCase.execute({
		at: new Date(),
		publicKey: createDummyPublicKeyString()
	});
	expect(result.isOk()).toBe(true);
	if (!result.isOk()) return;
});
