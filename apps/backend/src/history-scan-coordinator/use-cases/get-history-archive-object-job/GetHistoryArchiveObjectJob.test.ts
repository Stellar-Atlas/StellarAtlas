import { mock } from 'jest-mock-extended';
import type { Logger } from 'logger';
import { HistoryArchiveObject } from '../../domain/history-archive-object/HistoryArchiveObject.js';
import type { HistoryArchiveObjectRepository } from '../../domain/history-archive-object/HistoryArchiveObjectRepository.js';
import { GetHistoryArchiveObjectJob } from './GetHistoryArchiveObjectJob.js';

describe('GetHistoryArchiveObjectJob', () => {
	it('releases stale work before returning a claimed retry', async () => {
		const stale = checkpointObject(127, 'pending');
		stale.attempts = 1;
		const claimed = checkpointObject(191, 'scanning');
		claimed.attempts = 2;
		const objectRepository = mock<HistoryArchiveObjectRepository>();
		objectRepository.releaseStaleObjects.mockResolvedValue([stale]);
		objectRepository.claimNextObject.mockResolvedValue(claimed);
		const useCase = new GetHistoryArchiveObjectJob(
			objectRepository,
			mock<Logger>()
		);

		expect((await useCase.execute())._unsafeUnwrap()).toMatchObject({
			claimAttempt: 2,
			remoteId: claimed.remoteId
		});
	});

	it('runs stale release at most once during the maintenance interval', async () => {
		const objectRepository = mock<HistoryArchiveObjectRepository>();
		objectRepository.releaseStaleObjects.mockResolvedValue([]);
		objectRepository.claimNextObject.mockResolvedValue(null);
		const useCase = new GetHistoryArchiveObjectJob(
			objectRepository,
			mock<Logger>()
		);

		await useCase.execute();
		await useCase.execute();

		expect(objectRepository.releaseStaleObjects).toHaveBeenCalledTimes(1);
		expect(objectRepository.claimNextObject).toHaveBeenCalledTimes(2);
	});

	it('does not recompute proof state when merely claiming a job', async () => {
		const claimed = checkpointObject(255, 'scanning');
		const objectRepository = mock<HistoryArchiveObjectRepository>();
		objectRepository.releaseStaleObjects.mockResolvedValue([]);
		objectRepository.claimNextObject.mockResolvedValue(claimed);
		const useCase = new GetHistoryArchiveObjectJob(
			objectRepository,
			mock<Logger>()
		);

		await expect(useCase.execute()).resolves.toMatchObject({
			value: expect.objectContaining({ remoteId: claimed.remoteId })
		});
	});
});

function checkpointObject(
	checkpointLedger: number,
	status: HistoryArchiveObject['status']
): HistoryArchiveObject {
	return new HistoryArchiveObject({
		archiveUrl: 'https://jobs.example/archive',
		archiveUrlIdentity: 'https://jobs.example/archive',
		checkpointLedger,
		objectKey: `checkpoint-state:${checkpointLedger}`,
		objectOrder: 10,
		objectType: 'checkpoint-state',
		objectUrl: `https://jobs.example/archive/${checkpointLedger}.json`,
		status
	});
}
