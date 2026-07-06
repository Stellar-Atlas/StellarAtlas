import { mock, type MockProxy } from 'jest-mock-extended';
import { HistoryArchiveObject } from '../../../domain/history-archive-object/HistoryArchiveObject.js';
import type { HistoryArchiveObjectRepository } from '../../../domain/history-archive-object/HistoryArchiveObjectRepository.js';
import type { HistoryArchiveObjectEventRecorder } from '../../record-history-archive-object-event/HistoryArchiveObjectEventRecorder.js';
import { FailHistoryArchiveObject } from '../FailHistoryArchiveObject.js';

describe('FailHistoryArchiveObject', () => {
	let eventRecorder: MockProxy<HistoryArchiveObjectEventRecorder>;
	let objectRepository: MockProxy<HistoryArchiveObjectRepository>;

	beforeEach(() => {
		jest.useFakeTimers().setSystemTime(new Date('2026-07-06T14:00:00.000Z'));
		eventRecorder = mock<HistoryArchiveObjectEventRecorder>();
		objectRepository = mock<HistoryArchiveObjectRepository>();
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	it('stores retry timing from the object type and failure evidence', async () => {
		const archiveObject = new HistoryArchiveObject({
			archiveUrl: 'https://history.example.com',
			archiveUrlIdentity: 'https://history.example.com',
			objectKey: 'bucket:abc',
			objectOrder: 50,
			objectType: 'bucket',
			objectUrl: 'https://history.example.com/bucket/ab/cd/ef/bucket-abc.xdr.gz',
			remoteId: '11111111-1111-4111-8111-111111111111',
			status: 'scanning'
		});
		archiveObject.attempts = 1;
		objectRepository.findByRemoteId.mockResolvedValue(archiveObject);
		objectRepository.markObjectFailed.mockResolvedValue(true);

		const result = await new FailHistoryArchiveObject(
			objectRepository,
			eventRecorder
		).execute(archiveObject.remoteId, {
			claimAttempt: 1,
			errorMessage: 'HTTP 403 Forbidden',
			errorType: 'archive_http_error',
			httpStatus: 403
		});

		expect(result._unsafeUnwrap()).toBe(true);
		expect(objectRepository.markObjectFailed).toHaveBeenCalledWith(
			archiveObject.remoteId,
			{
				claimAttempt: 1,
				errorMessage: 'HTTP 403 Forbidden',
				errorType: 'archive_http_error',
				httpStatus: 403,
				nextAttemptAt: new Date('2026-07-06T14:16:00.000Z')
			}
		);
		expect(eventRecorder.record).toHaveBeenCalledWith(archiveObject, {
			claimAttempt: 1,
			eventType: 'failed',
			evidenceClass: 'archive-object'
		});
	});

	it('does not mutate a missing object row', async () => {
		objectRepository.findByRemoteId.mockResolvedValue(null);

		const result = await new FailHistoryArchiveObject(
			objectRepository,
			eventRecorder
		).execute('11111111-1111-4111-8111-111111111111', {
			claimAttempt: 1,
			errorMessage: 'missing row',
			errorType: 'worker_error'
		});

		expect(result._unsafeUnwrap()).toBe(false);
		expect(objectRepository.markObjectFailed).not.toHaveBeenCalled();
		expect(eventRecorder.record).not.toHaveBeenCalled();
	});
});
