import { mock } from 'jest-mock-extended';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
import { GetLatestOrganizationSnapshots } from '../GetLatestOrganizationSnapshots.js';
import type { OrganizationSnapShotRepository } from '@network-scan/domain/organization/OrganizationSnapShotRepository.js';

it('should capture and return errors', async function () {
	const repo = mock<OrganizationSnapShotRepository>();
	repo.findLatest.mockRejectedValue(new Error('test'));
	const exceptionLogger = mock<ExceptionLogger>();
	const useCase = new GetLatestOrganizationSnapshots(repo, exceptionLogger);
	const result = await useCase.execute({
		at: new Date()
	});
	expect(result.isErr()).toBe(true);
	expect(exceptionLogger.captureException).toHaveBeenCalledTimes(1);
});
