import { createObjectFromRow } from '../HistoryArchiveObjectRowMapper.js';

describe('HistoryArchiveObjectRowMapper', () => {
	it('maps public delay reason metadata from queue rows', () => {
		const object = createObjectFromRow({
			archiveUrl: 'https://history.example.com',
			archiveUrlIdentity: 'https://history.example.com',
			attempts: 2,
			createdAt: '2026-07-09T12:00:00.000Z',
			dependencyReady: false,
			delayReasonCode: 'host-backoff',
			delayReasonUntil: '2026-07-09T12:05:00.000Z',
			executionDisposition: 'deferred',
			hostIdentity: 'history.example.com',
			objectKey: 'root',
			objectOrder: 0,
			objectType: 'history-archive-state',
			objectUrl: 'https://history.example.com/.well-known/stellar-history.json',
			remoteId: '11111111-1111-4111-8111-111111111111',
			status: 'pending',
			updatedAt: '2026-07-09T12:01:00.000Z'
		});

		expect(object.delayReason).toEqual({
			code: 'host-backoff',
			until: '2026-07-09T12:05:00.000Z'
		});
		expect(object.dependencyReady).toBe(false);
		expect(object.executionDisposition).toBe('deferred');
	});

	it('keeps delay reason null when the row is immediately claimable', () => {
		const object = createObjectFromRow({
			archiveUrl: 'https://history.example.com',
			archiveUrlIdentity: 'https://history.example.com',
			attempts: 0,
			createdAt: '2026-07-09T12:00:00.000Z',
			delayReasonCode: null,
			delayReasonUntil: null,
			hostIdentity: 'history.example.com',
			objectKey: 'bucket:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
			objectOrder: 1,
			objectType: 'bucket',
			objectUrl:
				'https://history.example.com/bucket/aa/aa/aa/bucket-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.xdr.gz',
			remoteId: '22222222-2222-4222-8222-222222222222',
			status: 'pending',
			updatedAt: '2026-07-09T12:01:00.000Z'
		});

		expect(object.delayReason).toBeNull();
	});
});
