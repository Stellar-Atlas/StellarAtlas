import type { HistoryArchiveBrokerJob } from '../../../repositories/database/HistoryArchiveBrokerFrontierRepository.js';
import {
	calculateHistoryArchiveBrokerAvailableCapacity,
	calculateHistoryArchiveBrokerStreamMessageLimit,
	publishHistoryArchiveBrokerJobs,
	shouldReplayOrphanedPublishedJobs
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
	it('uses consumer occupancy when it is the larger constraint', () => {
		expect(calculateHistoryArchiveBrokerAvailableCapacity(240, 76, 0, 40)).toBe(
			164
		);
	});

	it('allows acknowledged stream-retention headroom without starving consumers', () => {
		expect(
			calculateHistoryArchiveBrokerAvailableCapacity(240, 112, 0, 189)
		).toBe(128);
	});

	it('preserves backpressure when stream-retention headroom is exhausted', () => {
		expect(
			calculateHistoryArchiveBrokerAvailableCapacity(240, 112, 0, 470)
		).toBe(10);
	});

	it('derives stream-retention headroom from the worker high watermark', () => {
		expect(calculateHistoryArchiveBrokerStreamMessageLimit(240)).toBe(480);
	});
});

describe('shouldReplayOrphanedPublishedJobs', () => {
	it('replays stranded reservations while unrelated stream work remains', () => {
		expect(shouldReplayOrphanedPublishedJobs(161, 30_000, 15_000)).toBe(true);
	});

	it('waits when no broker capacity is available', () => {
		expect(shouldReplayOrphanedPublishedJobs(0, 30_000, 15_000)).toBe(false);
	});

	it('honors the replay interval', () => {
		expect(shouldReplayOrphanedPublishedJobs(161, 14_999, 15_000)).toBe(false);
	});
});

describe('publishHistoryArchiveBrokerJobs', () => {
	it('keeps successful reservations published and resets only rejected messages', async () => {
		const acceptedId = '00000000-0000-0000-0000-000000000001';
		const rejectedId = '00000000-0000-0000-0000-000000000002';
		const publish = jest.fn(
			async (
				_subject: string,
				payload: Uint8Array,
				_options?: { msgID?: string }
			) => {
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

		expect(publish).toHaveBeenCalledWith(
			'archive.jobs',
			expect.any(Uint8Array),
			expect.objectContaining({
				msgID: expect.any(String),
				timeout: 5_000
			})
		);
		expect(publish.mock.calls.map((call) => call[2]?.msgID)).toEqual([
			acceptedId,
			rejectedId
		]);
		expect(resetPublished).toHaveBeenCalledTimes(1);
		expect(resetPublished).toHaveBeenCalledWith([rejectedId]);
	});
});
