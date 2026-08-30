import type { HistoryArchiveBrokerJob } from '../../../repositories/database/HistoryArchiveBrokerFrontierRepository.js';
import {
	calculateHistoryArchiveBrokerAvailableCapacity,
	publishHistoryArchiveBrokerJobs
} from '../HistoryArchiveBrokerDispatcher.js';

function createJob(executionId: string): HistoryArchiveBrokerJob {
	return {
		executionId,
		job: {
			archiveUrl: 'https://history.example',
			bucketHash: null,
			checkpointLedger: 63,
			claimAttempt: 1,
			objectKey: 'ledger:0000003f',
			objectType: 'ledger',
			objectUrl: 'https://history.example/ledger.xdr.gz',
			remoteId: executionId
		},
		priority: 1,
		selectedOrdinal: 1
	};
}

describe('calculateHistoryArchiveBrokerAvailableCapacity', () => {
	it('uses durable consumer occupancy instead of stale stream rows', () => {
		expect(calculateHistoryArchiveBrokerAvailableCapacity(240, 76, 0)).toBe(
			164
		);
	});
});

describe('publishHistoryArchiveBrokerJobs', () => {
	it('keeps successful reservations published and resets only rejected messages', async () => {
		const acceptedId = '00000000-0000-0000-0000-000000000001';
		const rejectedId = '00000000-0000-0000-0000-000000000002';
		const publish = jest.fn(async (_subject: string, payload: Uint8Array) => {
			const envelope = JSON.parse(Buffer.from(payload).toString()) as {
				executionId: string;
			};
			if (envelope.executionId === rejectedId) {
				throw new Error('NATS rejected');
			}
		});
		const resetPublished = jest.fn().mockResolvedValue(undefined);

		await expect(
			publishHistoryArchiveBrokerJobs(
				{ publish } as unknown as Parameters<
					typeof publishHistoryArchiveBrokerJobs
				>[0],
				{ resetPublished },
				'archive.jobs',
				[createJob(acceptedId), createJob(rejectedId)]
			)
		).rejects.toThrow('NATS rejected');

		expect(resetPublished).toHaveBeenCalledTimes(1);
		expect(resetPublished).toHaveBeenCalledWith([rejectedId]);
	});
});
