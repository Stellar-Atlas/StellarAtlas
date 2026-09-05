import { mock } from 'jest-mock-extended';
import type { Logger } from 'logger';
import { HistoryArchiveBrokerDispatcher } from '../HistoryArchiveBrokerDispatcher.js';
import type { HistoryArchiveBrokerConfig } from '../HistoryArchiveBrokerConfig.js';
import { HistoryArchiveBrokerFrontierRepository } from '../../../repositories/database/HistoryArchiveBrokerFrontierRepository.js';

describe('dispatcher current-frontier recovery', () => {
	const config: HistoryArchiveBrokerConfig = {
		batchSize: 120,
		highWatermark: 120,
		maximumPerHost: 8,
		maximumPriority: 2,
		canonicalFirstRoot: null,
		capacitySignalSubject: 'test.capacity',
		consumer: 'test',
		pollIntervalMs: 50,
		servers: [],
		stream: 'test',
		subject: 'test',
		token: undefined
	};

	it('runs bounded recovery with occupied workers, without waiting for an empty global queue', async () => {
		const repository = mock<HistoryArchiveBrokerFrontierRepository>();
		repository.recoverMissingFrontierReady.mockResolvedValue(1);
		repository.findPublishedJobs.mockResolvedValue([]);
		const dispatcher = new HistoryArchiveBrokerDispatcher(
			repository,
			config,
			mock<Logger>()
		);

		await dispatcher['replayOrphanedPublishedJobs'](60);
		expect(repository.recoverMissingFrontierReady).toHaveBeenCalledWith(120);
		expect(repository.requeueOrphanedPublishedJobs).not.toHaveBeenCalled();
		await dispatcher['replayOrphanedPublishedJobs'](60);
		expect(repository.recoverMissingFrontierReady).toHaveBeenCalledTimes(1);
	});

	it('does not add database work when all broker capacity is occupied', async () => {
		const repository = mock<HistoryArchiveBrokerFrontierRepository>();
		const dispatcher = new HistoryArchiveBrokerDispatcher(
			repository,
			config,
			mock<Logger>()
		);
		await dispatcher['replayOrphanedPublishedJobs'](0);
		expect(repository.recoverMissingFrontierReady).not.toHaveBeenCalled();
	});
});
