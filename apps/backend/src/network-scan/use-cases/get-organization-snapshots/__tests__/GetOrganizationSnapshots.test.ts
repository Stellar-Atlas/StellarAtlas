import { mock } from 'jest-mock-extended';
import type { ExceptionLogger } from '../../../../core/services/ExceptionLogger.js';
import { GetOrganizationSnapshots } from '../GetOrganizationSnapshots.js';
import { ExceptionLoggerMock } from '../../../../core/services/__mocks__/ExceptionLoggerMock.js';
import { createDummyOrganizationIdString } from '../../../domain/organization/__fixtures__/createDummyOrganizationId.js';
import type { OrganizationSnapShotRepository } from '../../../domain/organization/OrganizationSnapShotRepository.js';

it('should capture and return errors', async function () {
	const repo = mock<OrganizationSnapShotRepository>();
	repo.findLatestByOrganizationId.mockRejectedValue(new Error('test'));
	const exceptionLogger = mock<ExceptionLogger>();
	const useCase = new GetOrganizationSnapshots(repo, exceptionLogger);
	const result = await useCase.execute({
		at: new Date(),
		organizationId: createDummyOrganizationIdString()
	});
	expect(result.isErr()).toBe(true);
	expect(exceptionLogger.captureException).toHaveBeenCalledTimes(1);
});

it('should fetch latest snapshots', async () => {
	const repo = mock<OrganizationSnapShotRepository>();
	repo.findLatestByOrganizationId.mockResolvedValue([]);

	const useCase = new GetOrganizationSnapshots(repo, new ExceptionLoggerMock());
	const result = await useCase.execute({
		at: new Date(),
		organizationId: createDummyOrganizationIdString()
	});
	expect(result.isOk()).toBe(true);
	if (!result.isOk()) return;
});
