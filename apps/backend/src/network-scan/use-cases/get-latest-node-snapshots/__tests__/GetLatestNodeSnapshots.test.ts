import { mock } from 'jest-mock-extended';
import type { ExceptionLogger } from '../../../../core/services/ExceptionLogger.js';
import { GetLatestNodeSnapshots } from '../GetLatestNodeSnapshots.js';
import type { NodeSnapShotRepository } from '../../../domain/node/NodeSnapShotRepository.js';

it('should capture and return errors', async function () {
	const repo = mock<NodeSnapShotRepository>();
	repo.findLatest.mockRejectedValue(new Error('test'));
	const exceptionLogger = mock<ExceptionLogger>();
	const useCase = new GetLatestNodeSnapshots(repo, exceptionLogger);
	const result = await useCase.execute({
		at: new Date()
	});
	expect(result.isErr()).toBe(true);
	expect(exceptionLogger.captureException).toHaveBeenCalledTimes(1);
});
