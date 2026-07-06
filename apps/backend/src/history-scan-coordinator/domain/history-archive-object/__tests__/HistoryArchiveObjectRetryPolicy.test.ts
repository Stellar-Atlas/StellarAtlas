import {
	classifyHistoryArchiveObjectFailure,
	getHistoryArchiveObjectEvidenceClass,
	getHistoryArchiveObjectRetryDelayMs,
	getHistoryArchiveObjectRetryPolicy
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
		['http', 'archive-object'],
		['auth', 'archive-object'],
		['not-found', 'archive-object'],
		['rate-limit', 'archive-object'],
		['timeout', 'archive-object'],
		['transport', 'archive-object'],
		['unknown', 'archive-object'],
		['worker', 'worker-infrastructure'],
		['coordinator', 'coordinator-infrastructure']
	] satisfies readonly (readonly [
		HistoryArchiveObjectFailureClass,
		ReturnType<typeof getHistoryArchiveObjectEvidenceClass>
	])[])('maps %s failures to %s evidence', (failureClass, evidenceClass) => {
		expect(getHistoryArchiveObjectEvidenceClass(failureClass)).toBe(
			evidenceClass
		);
	});

	it('returns the next attempt, incremented retry count, and capped delay', () => {
		const now = new Date('2026-07-06T14:00:00.000Z');

		const result = getHistoryArchiveObjectRetryPolicy({
			currentRetryCount: 3,
			errorType: 'TYPE_TIMEOUT',
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
				now,
				objectType: 'history-archive-state'
			})
		).toMatchObject({
			evidenceClass: 'coordinator-infrastructure',
			failureClass: 'coordinator',
			isArchiveObjectEvidence: false
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
