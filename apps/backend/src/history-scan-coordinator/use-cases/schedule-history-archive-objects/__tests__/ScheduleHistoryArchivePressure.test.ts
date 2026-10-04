import { mock } from 'jest-mock-extended';
import type { Logger } from 'logger';
import type { HistoryArchiveObjectRepository } from '../../../domain/history-archive-object/HistoryArchiveObjectRepository.js';
import { ScheduleHistoryArchiveObjects } from '../ScheduleHistoryArchiveObjects.js';

it('logs an incomplete admission pressure sample as unknown, not an ordinary zero', async () => {
	const repository = mock<HistoryArchiveObjectRepository>();
	const logger = mock<Logger>();
	repository.planObjects.mockResolvedValue(0);
	repository.promotePlannedObjects.mockResolvedValue({
		availableSlots: 0,
		outstandingObjects: 0,
		outstandingObjectsCapped: true,
		pressureUnavailable: true,
		promotedObjects: 0,
		recentCompletions: null,
		watermark: 48
	});
	await new ScheduleHistoryArchiveObjects(repository, logger).execute([]);
	expect(logger.info).toHaveBeenCalledWith(
		'Scheduled history archive object checks',
		expect.objectContaining({
			outstandingObjects: 0,
			outstandingObjectsCapped: true,
			pressureUnavailable: true,
			promotedObjects: 0
		})
	);
});
