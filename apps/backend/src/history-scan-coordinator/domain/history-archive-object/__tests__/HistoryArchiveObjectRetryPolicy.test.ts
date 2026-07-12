import {
	classifyHistoryArchiveObjectFailure,
	getHistoryArchiveObjectEvidenceClass,
	getHistoryArchiveObjectRetryDelayMs,
	getHistoryArchiveObjectRetryPolicy,
	shouldThrottleHistoryArchiveObjectHost
} from '../HistoryArchiveObjectRetryPolicy.js';
import type { HistoryArchiveObjectFailureClass } from '../HistoryArchiveObjectRetryPolicy.js';
import type { HistoryArchiveObjectType } from '../HistoryArchiveObject.js';

describe('HistoryArchiveObjectRetryPolicy', () => {
	it.each([
		[401, 'auth'],
		[403, 'auth'],
		[404, 'not-found'],
		[410, 'not-found'],
		[408, 'timeout'],
		[504, 'timeout'],
		[429, 'rate-limit'],
		[500, 'http'],
		[418, 'http']
	] satisfies readonly (readonly [number, HistoryArchiveObjectFailureClass])[])(
		'classifies HTTP %s as %s',
		(httpStatus, failureClass) => {
			expect(
				classifyHistoryArchiveObjectFailure({
					errorType: 'worker-timeout',
					httpStatus
				})
			).toBe(failureClass);
		}
	);

	it.each([
		['TYPE_AUTH_FORBIDDEN', 'auth'],
		['TYPE_NOT_FOUND', 'not-found'],
		['too-many-requests', 'rate-limit'],
		['ETIMEDOUT', 'timeout'],
		['socket hang up', 'transport'],
		['TYPE_HTTP_STATUS', 'http'],
		['worker-startup-failed', 'worker'],
		['coordinator-claim-failed', 'coordinator'],
		['', 'unknown']
	] satisfies readonly (readonly [string, HistoryArchiveObjectFailureClass])[])(
		'classifies error type %s as %s',
		(errorType, failureClass) => {
			expect(classifyHistoryArchiveObjectFailure({ errorType })).toBe(
				failureClass
			);
		}
	);

	it.each([
		['http', 'archive_evidence', 'archive-object'],
		['auth', 'archive_evidence', 'archive-object'],
		['not-found', 'archive_evidence', 'archive-object'],
		['rate-limit', 'archive_evidence', 'archive-object'],
		['timeout', 'archive_evidence', 'archive-object'],
		['transport', 'archive_evidence', 'archive-object'],
		['unknown', 'archive_evidence', 'archive-object'],
		['worker', 'scanner_issue', 'worker-infrastructure'],
		['coordinator', 'scanner_issue', 'coordinator-infrastructure']
	] satisfies readonly (readonly [
		HistoryArchiveObjectFailureClass,
		'archive_evidence' | 'scanner_issue',
		ReturnType<typeof getHistoryArchiveObjectEvidenceClass>
	])[])(
		'maps %s failures to %s evidence',
		(failureClass, failureChannel, evidenceClass) => {
			expect(
				getHistoryArchiveObjectEvidenceClass(failureClass, failureChannel)
			).toBe(evidenceClass);
		}
	);

	it('returns the next attempt, incremented retry count, and capped delay', () => {
		const now = new Date('2026-07-06T14:00:00.000Z');

		const result = getHistoryArchiveObjectRetryPolicy({
			currentRetryCount: 3,
			errorType: 'TYPE_TIMEOUT',
			failureChannel: 'archive_evidence',
			httpStatus: null,
			now,
			objectType: 'ledger'
		});

		expect(result).toEqual({
			delayMs: 960_000,
			evidenceClass: 'archive-object',
			failureClass: 'timeout',
			isArchiveObjectEvidence: true,
			nextAttemptAt: new Date('2026-07-06T14:16:00.000Z'),
			retryCount: 4
		});
	});

	it('caps long backoff delays per failure class', () => {
		expect(
			getHistoryArchiveObjectRetryDelayMs({
				currentRetryCount: 20,
				failureClass: 'rate-limit',
				objectType: 'bucket'
			})
		).toBe(7_200_000);
	});

	it('keeps worker and coordinator failures out of archive object evidence', () => {
		const now = new Date('2026-07-06T15:00:00.000Z');

		expect(
			getHistoryArchiveObjectRetryPolicy({
				currentRetryCount: 0,
				errorType: 'worker_setup_failed',
				failureChannel: 'scanner_issue',
				now,
				objectType: 'history-archive-state'
			})
		).toMatchObject({
			evidenceClass: 'worker-infrastructure',
			failureClass: 'worker',
			isArchiveObjectEvidence: false
		});
		expect(
			getHistoryArchiveObjectRetryPolicy({
				currentRetryCount: 0,
				errorType: 'coordinator_claim_failed',
				failureChannel: 'scanner_issue',
				now,
				objectType: 'history-archive-state'
			})
		).toMatchObject({
			evidenceClass: 'coordinator-infrastructure',
			failureClass: 'coordinator',
			isArchiveObjectEvidence: false
		});
	});

	it('uses the typed channel even when an error name is misleading', () => {
		expect(
			getHistoryArchiveObjectRetryPolicy({
				currentRetryCount: 0,
				errorType: 'worker_error',
				failureChannel: 'archive_evidence',
				now: new Date('2026-07-06T15:00:00.000Z'),
				objectType: 'bucket'
			})
		).toMatchObject({
			evidenceClass: 'archive-object',
			isArchiveObjectEvidence: true
		});
	});

	it.each([
		['auth', 403, true],
		['rate-limit', 429, true],
		['timeout', 504, true],
		['transport', null, true],
		['http', 503, true],
		['http', 418, false],
		['not-found', 404, false],
		['unknown', null, false],
		['worker', null, false],
		['coordinator', null, false]
	] satisfies readonly (readonly [
		HistoryArchiveObjectFailureClass,
		number | null,
		boolean
	])[])(
		'throttle decision for %s/%s is %s',
		(failureClass, httpStatus, expected) => {
			expect(
				shouldThrottleHistoryArchiveObjectHost({
					errorType: null,
					failureClass,
					httpStatus
				})
			).toBe(expected);
		}
	);

	it('never throttles an explicit worker/coordinator error with an HTTP status', () => {
		expect(
			shouldThrottleHistoryArchiveObjectHost({
				errorType: 'worker_coordinator_error',
				failureClass: 'http',
				httpStatus: 503
			})
		).toBe(false);
	});

	it('never throttles an explicit integrity mismatch with an HTTP status', () => {
		expect(
			shouldThrottleHistoryArchiveObjectHost({
				errorType: 'HASH_MISMATCH',
				failureClass: 'http',
				httpStatus: 503
			})
		).toBe(false);
	});

	it('honors a longer Retry-After response than exponential backoff', () => {
		const now = new Date('2026-07-06T15:00:00.000Z');
		expect(
			getHistoryArchiveObjectRetryPolicy({
				currentRetryCount: 0,
				errorType: 'archive_http_error',
				failureChannel: 'archive_evidence',
				httpStatus: 429,
				now,
				objectType: 'ledger',
				retryAfterSeconds: 900
			})
		).toMatchObject({
			delayMs: 900_000,
			nextAttemptAt: new Date('2026-07-06T15:15:00.000Z')
		});
	});

	it.each([
		['history-archive-state', 60_000],
		['checkpoint-state', 90_000],
		['ledger', 120_000],
		['transactions', 120_000],
		['results', 120_000],
		['scp', 120_000],
		['bucket', 240_000]
	] satisfies readonly (readonly [HistoryArchiveObjectType, number])[])(
		'uses the %s object base delay',
		(objectType, delayMs) => {
			expect(
				getHistoryArchiveObjectRetryDelayMs({
					currentRetryCount: 0,
					failureClass: 'transport',
					objectType
				})
			).toBe(delayMs);
		}
	);
});
