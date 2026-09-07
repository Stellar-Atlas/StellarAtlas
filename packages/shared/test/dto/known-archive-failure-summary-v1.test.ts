import Ajv from 'ajv';
import * as addFormats from 'ajv-formats';
import { KnownArchiveFailureSummaryV1Schema } from '../../src/dto/known-archive-failure-summary-v1.js';

describe('source reason summary public schema', () => {
	const ajv = new Ajv();
	addFormats.default(ajv);
	const validate = ajv.compile(KnownArchiveFailureSummaryV1Schema);
	const summary = {
		status: 'current',
		computedAt: '2026-09-07T00:00:00Z',
		limit: 20,
		groups: [
			{
				objectType: 'ledger',
				failureChannel: 'archive_evidence',
				errorType: 'http_error',
				errorMessage: 'HTTP 404 Not Found',
				httpStatus: 404,
				count: 25
			}
		],
		totalGroups: 1,
		remainingGroupCount: 0,
		remainingFailureCount: 0,
		remoteFailureCount: 25,
		workerIssueCount: 100
	};
	it('accepts complete source counts beyond the visible object page', () =>
		expect(validate(summary)).toBe(true));
	it('accepts distinct checkpoint attribution and explicitly unknown metadata counts', () => {
		expect(
			validate({
				...summary,
				knownAffectedCheckpointCount: 12,
				unknownCheckpointFailureCount: 3,
				groups: [
					{
						...summary.groups[0],
						knownAffectedCheckpointCount: 12,
						unknownCheckpointFailureCount: 3
					}
				]
			})
		).toBe(true);
		expect(validate({ ...summary, knownAffectedCheckpointCount: -1 })).toBe(
			false
		);
	});
	it('supports explicit stale and unavailable states', () => {
		expect(validate({ ...summary, status: 'stale' })).toBe(true);
		expect(
			validate({
				...summary,
				status: 'unavailable',
				computedAt: null,
				groups: [],
				totalGroups: null,
				remainingGroupCount: null,
				remainingFailureCount: null,
				remoteFailureCount: null,
				workerIssueCount: null
			})
		).toBe(true);
	});
	it('rejects worker groups, unbounded groups and negative counts', () => {
		expect(
			validate({
				...summary,
				groups: [{ ...summary.groups[0], failureChannel: 'scanner_issue' }]
			})
		).toBe(false);
		expect(
			validate({
				...summary,
				groups: Array.from({ length: 21 }, () => summary.groups[0])
			})
		).toBe(false);
		expect(validate({ ...summary, remoteFailureCount: -1 })).toBe(false);
	});
});
