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
		repository.ensurePrefetch.mockResolvedValue(1);
		repository.findPublishedJobs.mockResolvedValue([]);
		const dispatcher = new HistoryArchiveBrokerDispatcher(
			repository,
			config,
			mock<Logger>()
		);

		await dispatcher['replayOrphanedPublishedJobs'](60);
		expect(repository.ensurePrefetch).toHaveBeenCalledWith(null);
		expect(repository.recoverMissingFrontierReady).toHaveBeenCalledWith(120);
		expect(repository.requeueOrphanedPublishedJobs).not.toHaveBeenCalled();
		await dispatcher['replayOrphanedPublishedJobs'](60);
		expect(repository.ensurePrefetch).toHaveBeenCalledTimes(1);
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
		expect(repository.ensurePrefetch).not.toHaveBeenCalled();
		expect(repository.recoverMissingFrontierReady).not.toHaveBeenCalled();
	});

	it('materializes an unqueued frontier before reserving a nonempty unrelated root', async () => {
		const repository = mock<HistoryArchiveBrokerFrontierRepository>();
		repository.ensurePrefetch.mockResolvedValue(1);
		repository.recoverMissingFrontierReady.mockResolvedValue(0);
		repository.findPublishedJobs.mockResolvedValue([]);
		repository.reserveJobs.mockResolvedValue([
			{
				executionId: '00000000-0000-0000-0000-000000000001',
				priority: 1,
				selectedOrdinal: 1,
				job: {
					archiveUrl: 'https://unrelated.example/history',
					bucketHash: null,
					checkpointLedger: 127,
					claimAttempt: 1,
					objectKey: 'ledger:0000007f',
					objectType: 'ledger',
					objectUrl: 'https://unrelated.example/history/ledger.xdr.gz',
					remoteId: '00000000-0000-0000-0000-000000000001'
				}
			}
		]);
		const dispatcher = new HistoryArchiveBrokerDispatcher(
			repository,
			config,
			mock<Logger>()
		);
		dispatcher['initialize'] = async () => undefined;
		dispatcher['initializeReadyListener'] = async () => undefined;
		dispatcher['getAvailableCapacity'] = async () => 60;
		dispatcher['publish'] = async () => {
			await dispatcher.close();
		};
		await dispatcher.run();
		expect(repository.reserveJobs).toHaveBeenCalledTimes(1);
		expect(repository.ensurePrefetch).toHaveBeenCalledTimes(1);
		expect(repository.ensurePrefetch.mock.invocationCallOrder[0]).toBeLessThan(
			repository.reserveJobs.mock.invocationCallOrder[0]!
		);
		expect(repository.ensureFrontier).not.toHaveBeenCalled();
	});
});
