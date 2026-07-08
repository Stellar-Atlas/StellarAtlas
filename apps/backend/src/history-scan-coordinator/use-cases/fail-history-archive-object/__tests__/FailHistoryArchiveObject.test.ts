import { mock, type MockProxy } from 'jest-mock-extended';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
import type { HistoryArchiveCheckpointProofRepository } from '../../../domain/history-archive-checkpoint-proof/HistoryArchiveCheckpointProofRepository.js';
import { HistoryArchiveObject } from '../../../domain/history-archive-object/HistoryArchiveObject.js';
import type { HistoryArchiveObjectRepository } from '../../../domain/history-archive-object/HistoryArchiveObjectRepository.js';
import type { HistoryArchiveObjectEventRecorder } from '../../record-history-archive-object-event/HistoryArchiveObjectEventRecorder.js';
import { FailHistoryArchiveObject } from '../FailHistoryArchiveObject.js';

describe('FailHistoryArchiveObject', () => {
	let eventRecorder: MockProxy<HistoryArchiveObjectEventRecorder>;
	let checkpointProofRepository: MockProxy<HistoryArchiveCheckpointProofRepository>;
	let exceptionLogger: MockProxy<ExceptionLogger>;
	let objectRepository: MockProxy<HistoryArchiveObjectRepository>;

	beforeEach(() => {
		jest.useFakeTimers().setSystemTime(new Date('2026-07-06T14:00:00.000Z'));
		eventRecorder = mock<HistoryArchiveObjectEventRecorder>();
		checkpointProofRepository = mock<HistoryArchiveCheckpointProofRepository>();
		exceptionLogger = mock<ExceptionLogger>();
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
			objectUrl:
				'https://history.example.com/bucket/ab/cd/ef/bucket-abc.xdr.gz',
			remoteId: '11111111-1111-4111-8111-111111111111',
			status: 'scanning'
		});
		archiveObject.attempts = 1;
		objectRepository.findByRemoteId.mockResolvedValue(archiveObject);
		objectRepository.markObjectFailed.mockResolvedValue(true);

		const result = await new FailHistoryArchiveObject(
			objectRepository,
			eventRecorder,
			checkpointProofRepository,
			exceptionLogger
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
		expect(objectRepository.recordHostFailure).toHaveBeenCalledWith({
			archiveUrlIdentity: archiveObject.archiveUrlIdentity,
			blockedUntil: new Date('2026-07-06T14:16:00.000Z'),
			errorType: 'archive_http_error',
			evidenceClass: 'archive-object',
			failureClass: 'auth',
			hostIdentity: 'history.example.com',
			httpStatus: 403
		});
		expect(eventRecorder.record).toHaveBeenCalledWith(archiveObject, {
			claimAttempt: 1,
			eventType: 'failed',
			evidenceClass: 'archive-object'
		});
		expect(checkpointProofRepository.refreshForObject).not.toHaveBeenCalled();
	});

	it('does not mutate a missing object row', async () => {
		objectRepository.findByRemoteId.mockResolvedValue(null);

		const result = await new FailHistoryArchiveObject(
			objectRepository,
			eventRecorder,
			checkpointProofRepository,
			exceptionLogger
		).execute('11111111-1111-4111-8111-111111111111', {
			claimAttempt: 1,
			errorMessage: 'missing row',
			errorType: 'worker_error'
		});

		expect(result._unsafeUnwrap()).toBe(false);
		expect(objectRepository.markObjectFailed).not.toHaveBeenCalled();
		expect(eventRecorder.record).not.toHaveBeenCalled();
	});

	it('does not fail object failure recording when checkpoint proof refresh fails', async () => {
		const archiveObject = new HistoryArchiveObject({
			archiveUrl: 'https://history.example.com',
			archiveUrlIdentity: 'https://history.example.com',
			checkpointLedger: 127,
			objectKey: 'ledger:0000007f',
			objectOrder: 20,
			objectType: 'ledger',
			objectUrl:
				'https://history.example.com/ledger/00/00/00/ledger-0000007f.xdr.gz',
			remoteId: '11111111-1111-4111-8111-111111111111',
			status: 'scanning'
		});
		archiveObject.attempts = 1;
		objectRepository.findByRemoteId.mockResolvedValue(archiveObject);
		objectRepository.markObjectFailed.mockResolvedValue(true);
		checkpointProofRepository.refreshForObject.mockRejectedValue(
			new Error('proof refresh failed')
		);

		const result = await new FailHistoryArchiveObject(
			objectRepository,
			eventRecorder,
			checkpointProofRepository,
			exceptionLogger
		).execute(archiveObject.remoteId, {
			claimAttempt: 1,
			errorMessage: 'Wrong ledger hash',
			errorType: 'category_verification_failed'
		});

		expect(result._unsafeUnwrap()).toBe(true);
		expect(exceptionLogger.captureException).toHaveBeenCalledWith(
			expect.objectContaining({ message: 'proof refresh failed' })
		);
	});
});
