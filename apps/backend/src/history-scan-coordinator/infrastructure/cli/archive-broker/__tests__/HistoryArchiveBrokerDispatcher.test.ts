import type { JetStreamClient } from 'nats';
import { publishHistoryArchiveBrokerJobs } from '../HistoryArchiveBrokerDispatcher.js';
import type { HistoryArchiveBrokerJob } from '../../../repositories/database/HistoryArchiveBrokerFrontierRepository.js';

function createJob(
	executionId: string,
	selectedOrdinal: number
): HistoryArchiveBrokerJob {
	return {
		executionId,
		job: {
			archiveUrl: 'https://archive.example',
			bucketHash: null,
			checkpointLedger: 63,
			claimAttempt: 1,
			objectKey: `ledger:${executionId}`,
			objectType: 'ledger',
			objectUrl: `https://archive.example/${executionId}`,
			remoteId: `remote-${executionId}`
		},
		priority: 0,
		selectedOrdinal
	};
}

describe('publishHistoryArchiveBrokerJobs', () => {
	it('does not write a second success marker after publishing', async () => {
		const publish = jest.fn().mockResolvedValue({});
		const markPublishFailed = jest.fn().mockResolvedValue(undefined);

		await publishHistoryArchiveBrokerJobs(
			{ publish } as unknown as Pick<JetStreamClient, 'publish'>,
			{ markPublishFailed },
			'archive.objects',
			[createJob('00000000-0000-4000-8000-000000000001', 1)]
		);

		expect(publish).toHaveBeenCalledTimes(1);
		expect(markPublishFailed).toHaveBeenCalledWith([]);
	});

	it('resets only failed publications so they can be retried', async () => {
		const publicationFailure = new Error('publish failed');
		const publish = jest
			.fn()
			.mockResolvedValueOnce({})
			.mockRejectedValueOnce(publicationFailure);
		const markPublishFailed = jest.fn().mockResolvedValue(undefined);
		const successfulId = '00000000-0000-4000-8000-000000000001';
		const failedId = '00000000-0000-4000-8000-000000000002';

		await expect(
			publishHistoryArchiveBrokerJobs(
				{ publish } as unknown as Pick<JetStreamClient, 'publish'>,
				{ markPublishFailed },
				'archive.objects',
				[createJob(successfulId, 1), createJob(failedId, 2)]
			)
		).rejects.toBe(publicationFailure);

		expect(markPublishFailed).toHaveBeenCalledWith([failedId]);
	});
});
