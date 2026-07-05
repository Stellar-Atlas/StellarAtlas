import { mock, MockProxy } from 'jest-mock-extended';
import { err, ok } from 'neverthrow';
import { GetArchiveQueueStatus } from '../../get-archive-queue-status/GetArchiveQueueStatus.js';
import { GetDataFreshnessStatus } from '../../get-data-freshness-status/GetDataFreshnessStatus.js';
import { GetRollupStatus } from '../../get-rollup-status/GetRollupStatus.js';
import { GetScanStatus } from '../../get-scan-status/GetScanStatus.js';
import { GetDataQualityStatus } from '../GetDataQualityStatus.js';

describe('GetDataQualityStatus', () => {
	let getDataFreshnessStatusMock: MockProxy<GetDataFreshnessStatus>;
	let getScanStatusMock: MockProxy<GetScanStatus>;
	let getRollupStatusMock: MockProxy<GetRollupStatus>;
	let getArchiveQueueStatusMock: MockProxy<GetArchiveQueueStatus>;
	let getDataQualityStatus: GetDataQualityStatus;

	beforeEach(() => {
		jest.useFakeTimers().setSystemTime(new Date('2026-07-03T12:00:00.000Z'));
		getDataFreshnessStatusMock = mock<GetDataFreshnessStatus>();
		getScanStatusMock = mock<GetScanStatus>();
		getRollupStatusMock = mock<GetRollupStatus>();
		getArchiveQueueStatusMock = mock<GetArchiveQueueStatus>();
		getDataQualityStatus = new GetDataQualityStatus(
			getDataFreshnessStatusMock,
			getScanStatusMock,
			getRollupStatusMock,
			getArchiveQueueStatusMock
		);
		getDataFreshnessStatusMock.execute.mockResolvedValue(ok(dataFreshness()));
		getScanStatusMock.execute.mockResolvedValue(ok(scans()));
		getRollupStatusMock.execute.mockResolvedValue(ok(rollups()));
		getArchiveQueueStatusMock.execute.mockResolvedValue(ok(archiveQueue()));
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	it('should aggregate persisted data-quality evidence', async () => {
		const result = await getDataQualityStatus.execute();

		expect(result.isOk()).toBe(true);
		expect(result._unsafeUnwrap()).toMatchObject({
			generatedAt: '2026-07-03T12:00:00.000Z',
			status: 'ok',
			dataFreshness: { status: 'ok' },
			scans: { status: 'ok' },
			rollups: { status: 'ok' },
			archiveQueue: { status: 'ok' }
		});
	});

	it('should surface the worst data-quality status', async () => {
		getRollupStatusMock.execute.mockResolvedValue(
			ok({
				...rollups(),
				status: 'degraded',
				networkRollups: {
					...rollups().networkRollups,
					status: 'degraded',
					mismatchedRollupDays: 1
				}
			})
		);

		const result = await getDataQualityStatus.execute();

		expect(result.isOk()).toBe(true);
		expect(result._unsafeUnwrap().status).toBe('degraded');
	});

	it('should keep archive queue health separate from data-quality status', async () => {
		getArchiveQueueStatusMock.execute.mockResolvedValue(
			ok({
				...archiveQueue(),
				status: 'degraded',
				staleJobs: 3
			})
		);

		const result = await getDataQualityStatus.execute();

		expect(result.isOk()).toBe(true);
		expect(result._unsafeUnwrap()).toMatchObject({
			status: 'ok',
			archiveQueue: { status: 'degraded', staleJobs: 3 }
		});
	});

	it('should pass through section errors', async () => {
		const error = new Error('scan status unavailable');
		getScanStatusMock.execute.mockResolvedValue(err(error));

		const result = await getDataQualityStatus.execute();

		expect(result.isErr()).toBe(true);
		expect(result._unsafeUnwrapErr()).toBe(error);
	});
});

function dataFreshness() {
	return {
		generatedAt: '2026-07-03T12:00:00.000Z',
		status: 'ok' as const,
		networkScan: {
			status: 'ok' as const,
			latestAt: '2026-07-03T11:55:00.000Z',
			ageMs: 300000,
			staleAfterMs: 3600000
		},
		archiveScan: {
			status: 'ok' as const,
			latestAt: '2026-07-03T11:50:00.000Z',
			ageMs: 600000,
			staleAfterMs: null
		}
	};
}

function scans() {
	return {
		generatedAt: '2026-07-03T12:00:00.000Z',
		status: 'ok' as const,
		networkScan: {
			status: 'ok' as const,
			windowStart: '2026-07-02T12:00:00.000Z',
			windowEnd: '2026-07-03T12:00:00.000Z',
			windowMs: 86400000,
			scanIntervalMs: 180000,
			expectedScans: 480,
			totalScans: 480,
			completedScans: 479,
			incompleteScans: 1,
			completionRate: 99.79,
			expectedCompletionRate: 99.79,
			latestScanAt: '2026-07-03T11:59:00.000Z',
			latestCompletedScanAt: '2026-07-03T11:56:00.000Z'
		}
	};
}

function rollups() {
	return {
		generatedAt: '2026-07-03T12:00:00.000Z',
		status: 'ok' as const,
		networkRollups: {
			status: 'ok' as const,
			windowStart: '2026-06-26T00:00:00.000Z',
			windowEnd: '2026-07-03T00:00:00.000Z',
			windowDays: 7,
			rawCompletedScans: 70,
			rollupCrawlCount: 70,
			daysWithCompletedScans: 7,
			daysWithRollups: 7,
			matchingDays: 7,
			missingRollupDays: 0,
			mismatchedRollupDays: 0,
			latestRollupDay: '2026-07-02T00:00:00.000Z',
			days: []
		}
	};
}

function archiveQueue() {
	return {
		generatedAt: '2026-07-03T12:00:00.000Z',
		status: 'ok' as const,
		pendingJobs: 0,
		activeJobs: 0,
		staleJobs: 0,
		totalUnfinishedJobs: 0,
		staleJobAgeMs: 1800000
	};
}
