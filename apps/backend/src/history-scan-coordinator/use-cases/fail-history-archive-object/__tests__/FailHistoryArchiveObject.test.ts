import { mock, type MockProxy } from 'jest-mock-extended';
import type { HistoryArchiveCheckpointProofRepository } from '../../../domain/history-archive-checkpoint-proof/HistoryArchiveCheckpointProofRepository.js';
import { HistoryArchiveObject } from '../../../domain/history-archive-object/HistoryArchiveObject.js';
import type { HistoryArchiveObjectRepository } from '../../../domain/history-archive-object/HistoryArchiveObjectRepository.js';
import type { HistoryArchiveObjectEventRecorder } from '../../record-history-archive-object-event/HistoryArchiveObjectEventRecorder.js';
import { FailHistoryArchiveObject } from '../FailHistoryArchiveObject.js';

describe('FailHistoryArchiveObject', () => {
	let eventRecorder: MockProxy<HistoryArchiveObjectEventRecorder>;
	let checkpointProofRepository: MockProxy<HistoryArchiveCheckpointProofRepository>;
	let objectRepository: MockProxy<HistoryArchiveObjectRepository>;

	beforeEach(() => {
		jest.useFakeTimers().setSystemTime(new Date('2026-07-06T14:00:00.000Z'));
		eventRecorder = mock<HistoryArchiveObjectEventRecorder>();
		checkpointProofRepository = mock<HistoryArchiveCheckpointProofRepository>();
		objectRepository = mock<HistoryArchiveObjectRepository>();
		objectRepository.markObjectFailed.mockImplementation(
			async (remoteId, failure) => {
				const object = await objectRepository.findByRemoteId(remoteId);
				if (object === null) return false;
				object.status = 'failed';
				object.errorMessage = failure.errorMessage;
				object.errorType = failure.errorType;
				object.failureChannel = failure.failureChannel;
				object.httpStatus = failure.httpStatus ?? null;
				object.transitionEffectsRequiredAt = new Date();
				return true;
			}
		);
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	it('stores retry timing from the object type and failure evidence', async () => {
		const archiveObject = new HistoryArchiveObject({
			archiveUrl: 'https://history.example.com',
			archiveUrlIdentity: 'https://history.example.com',
			bucketHash:
				'abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd',
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

		const result = await new FailHistoryArchiveObject(
			objectRepository,
			eventRecorder,
			checkpointProofRepository
		).execute(archiveObject.remoteId, {
			claimAttempt: 1,
			errorMessage: 'HTTP 403 Forbidden',
			errorType: 'archive_http_error',
			failureChannel: 'archive_evidence',
			httpStatus: 403
		});

		expect(result._unsafeUnwrap()).toBe(true);
		expect(objectRepository.markObjectFailed).toHaveBeenCalledWith(
			archiveObject.remoteId,
			{
				claimAttempt: 1,
				errorMessage: 'HTTP 403 Forbidden',
				errorType: 'archive_http_error',
				failureChannel: 'archive_evidence',
				httpStatus: 403,
				nextAttemptAt: new Date('2026-07-06T14:16:00.000Z')
			},
			{
				archiveUrlIdentity: archiveObject.archiveUrlIdentity,
				blockedUntil: new Date('2026-07-06T14:16:00.000Z'),
				errorType: 'archive_http_error',
				evidenceClass: 'archive-object',
				failureClass: 'auth',
				hostIdentity: 'history.example.com',
				httpStatus: 403,
				retryAfterUntil: null
			}
		);
		expect(eventRecorder.recordDurably).toHaveBeenCalledWith(archiveObject, {
			claimAttempt: 1,
			eventType: 'failed',
			evidenceClass: 'archive-object'
		});
		expect(checkpointProofRepository.refreshForObject).toHaveBeenCalledWith(
			archiveObject
		);
	});

	it('does not mutate a missing object row', async () => {
		objectRepository.findByRemoteId.mockResolvedValue(null);

		const result = await new FailHistoryArchiveObject(
			objectRepository,
			eventRecorder,
			checkpointProofRepository
		).execute('11111111-1111-4111-8111-111111111111', {
			claimAttempt: 1,
			errorMessage: 'missing row',
			errorType: 'worker_error',
			failureChannel: 'scanner_issue'
		});

		expect(result._unsafeUnwrap()).toBe(false);
		expect(objectRepository.markObjectFailed).not.toHaveBeenCalled();
		expect(eventRecorder.recordDurably).not.toHaveBeenCalled();
	});

	it.each([
		['object-specific 404', 'archive_http_error', 404, 'archive_evidence'],
		['wrong hash', 'category_verification_failed', null, 'archive_evidence'],
		['worker failure', 'worker_setup_failed', null, 'scanner_issue'],
		['coordinator failure', 'coordinator_claim_failed', null, 'scanner_issue']
	] as const)(
		'does not throttle the host for %s',
		async (_label, errorType, httpStatus, failureChannel) => {
			const archiveObject = new HistoryArchiveObject({
				archiveUrl: 'https://history.example.com',
				archiveUrlIdentity: 'https://history.example.com',
				objectKey: 'root',
				objectOrder: 0,
				objectType: 'history-archive-state',
				objectUrl:
					'https://history.example.com/.well-known/stellar-history.json',
				remoteId: '11111111-1111-4111-8111-111111111111',
				status: 'scanning'
			});
			archiveObject.attempts = 1;
			objectRepository.findByRemoteId.mockResolvedValue(archiveObject);

			const result = await new FailHistoryArchiveObject(
				objectRepository,
				eventRecorder,
				checkpointProofRepository
			).execute(archiveObject.remoteId, {
				claimAttempt: 1,
				errorMessage: String(_label),
				errorType,
				failureChannel,
				httpStatus
			});

			expect(result._unsafeUnwrap()).toBe(true);
			expect(objectRepository.markObjectFailed).toHaveBeenCalledWith(
				archiveObject.remoteId,
				expect.objectContaining({ errorType, httpStatus }),
				undefined
			);
		}
	);

	it('reports failure when durable checkpoint proof refresh fails', async () => {
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
		checkpointProofRepository.refreshForObject.mockRejectedValue(
			new Error('proof refresh failed')
		);

		const result = await new FailHistoryArchiveObject(
			objectRepository,
			eventRecorder,
			checkpointProofRepository
		).execute(archiveObject.remoteId, {
			claimAttempt: 1,
			errorMessage: 'Wrong ledger hash',
			errorType: 'category_verification_failed',
			failureChannel: 'archive_evidence'
		});

		expect(result._unsafeUnwrapErr()).toEqual(
			expect.objectContaining({ message: 'proof refresh failed' })
		);
		expect(eventRecorder.recordDurably).not.toHaveBeenCalled();
	});

	it('retries durable proof refresh for an exact failed-attempt replay', async () => {
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
			status: 'failed'
		});
		archiveObject.attempts = 1;
		archiveObject.errorMessage = 'Wrong ledger hash';
		archiveObject.errorType = 'category_verification_failed';
		archiveObject.failureChannel = 'archive_evidence';
		archiveObject.httpStatus = 200;
		objectRepository.findByRemoteId.mockResolvedValue(archiveObject);
		objectRepository.markObjectFailed.mockResolvedValue(false);

		const result = await new FailHistoryArchiveObject(
			objectRepository,
			eventRecorder,
			checkpointProofRepository
		).execute(archiveObject.remoteId, {
			claimAttempt: 1,
			errorMessage: 'Wrong ledger hash',
			errorType: 'category_verification_failed',
			failureChannel: 'archive_evidence',
			httpStatus: 200
		});

		expect(result._unsafeUnwrap()).toBe(true);
		expect(checkpointProofRepository.refreshForObject).toHaveBeenCalledWith(
			archiveObject
		);
		expect(eventRecorder.recordDurably).toHaveBeenCalled();
	});

	it('rejects a stale failure replay with different persisted evidence', async () => {
		const archiveObject = new HistoryArchiveObject({
			archiveUrl: 'https://history.example.com',
			archiveUrlIdentity: 'https://history.example.com',
			checkpointLedger: 127,
			objectKey: 'ledger:0000007f',
			objectOrder: 20,
			objectType: 'ledger',
			objectUrl:
				'https://history.example.com/ledger/00/00/00/ledger-0000007f.xdr.gz',
			status: 'failed'
		});
		archiveObject.attempts = 1;
		archiveObject.errorMessage = 'Persisted failure';
		archiveObject.errorType = 'archive_http_error';
		archiveObject.failureChannel = 'archive_evidence';
		archiveObject.httpStatus = 503;
		objectRepository.findByRemoteId.mockResolvedValue(archiveObject);
		objectRepository.markObjectFailed.mockResolvedValue(false);

		const result = await new FailHistoryArchiveObject(
			objectRepository,
			eventRecorder,
			checkpointProofRepository
		).execute(archiveObject.remoteId, {
			claimAttempt: 1,
			errorMessage: 'Different failure',
			errorType: 'category_verification_failed',
			failureChannel: 'archive_evidence',
			httpStatus: 200
		});

		expect(result._unsafeUnwrap()).toBe(false);
		expect(checkpointProofRepository.refreshForObject).not.toHaveBeenCalled();
	});
});
