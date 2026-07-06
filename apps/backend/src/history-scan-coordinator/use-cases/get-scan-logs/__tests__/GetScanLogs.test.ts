import { mock, MockProxy } from 'jest-mock-extended';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
import { Url } from '@core/domain/Url.js';
import { Scan } from '@history-scan-coordinator/domain/scan/Scan.js';
import type { ScanRepository } from '@history-scan-coordinator/domain/scan/ScanRepository.js';
import {
	ScanError,
	ScanErrorType
} from '@history-scan-coordinator/domain/scan/ScanError.js';
import { ScanJob } from '@history-scan-coordinator/domain/ScanJob.js';
import type { ScanJobRepository } from '@history-scan-coordinator/domain/ScanJobRepository.js';
import { GetScanLogs } from '../GetScanLogs.js';

describe('GetScanLogs', () => {
	let getScanLogs: GetScanLogs;
	let scanRepositoryMock: MockProxy<ScanRepository>;
	let scanJobRepositoryMock: MockProxy<ScanJobRepository>;
	let exceptionLoggerMock: MockProxy<ExceptionLogger>;

	const historyUrlResult = Url.create(
		'https://stellar-full-history2.bdnodes.net'
	);
	if (historyUrlResult.isErr()) throw historyUrlResult.error;
	const historyUrl = historyUrlResult.value;

	beforeEach(() => {
		scanRepositoryMock = mock<ScanRepository>();
		scanJobRepositoryMock = mock<ScanJobRepository>();
		exceptionLoggerMock = mock<ExceptionLogger>();
		getScanLogs = new GetScanLogs(
			scanRepositoryMock,
			scanJobRepositoryMock,
			exceptionLoggerMock
		);
	});

	it('returns active jobs, stale jobs, archive errors, and successes as distinct public log entries', async () => {
		const now = Date.now();
		const activeJob = new ScanJob(
			historyUrl.value,
			58_583_679,
			null,
			new Date('2026-07-03T00:00:00.000Z'),
			58_583_680,
			null,
			50,
			'6e2a0f88-6b73-44b0-8fd7-e061bc846ac2'
		);
		activeJob.latestAttemptedLedger = 58_584_000;
		activeJob.currentRangeFromLedger = 58_583_680;
		activeJob.currentRangeToLedger = 58_584_000;
		activeJob.status = 'TAKEN';
		activeJob.claimedAt = new Date(now - 60_000);
		activeJob.createdAt = new Date(now - 20 * 60_000);
		activeJob.updatedAt = new Date(now - 30_000);

		const staleJob = new ScanJob(
			historyUrl.value,
			58_583_600,
			null,
			new Date('2026-07-03T00:00:00.000Z'),
			58_583_601,
			58_584_000,
			32,
			'9a1c0e8d-41aa-41c4-8b21-779671b6f003'
		);
		staleJob.status = 'TAKEN';
		staleJob.createdAt = new Date(now - 60 * 60_000);
		staleJob.updatedAt = new Date(now - 31 * 60_000);

		const archiveVerificationFailure = createScan(
			new Date('2026-04-05T01:51:00.000Z'),
			50,
			new ScanError(
				ScanErrorType.TYPE_VERIFICATION,
				`${historyUrl.value}/transactions/03/80/a5/transactions-0380a53f.xdr.gz`,
				'Wrong transaction hash'
			)
		);
		const successfulScan = createScan(
			new Date('2026-04-04T01:51:00.000Z'),
			24,
			null
		);

		scanJobRepositoryMock.findActiveByUrl.mockResolvedValue([
			activeJob,
			staleJob
		]);
		scanRepositoryMock.findRecentByUrl.mockResolvedValue([
			archiveVerificationFailure,
			successfulScan
		]);

		const result = await getScanLogs.execute(historyUrl.value);

		expect(result.isOk()).toBe(true);
		const logs = result._unsafeUnwrap();
		expect(scanRepositoryMock.findRecentByUrl).toHaveBeenCalledWith(
			historyUrl.value,
			50
		);
		expect(logs).toHaveLength(4);
		expect(logs.map((log) => log.status)).toEqual([
			'scanning',
			'stale',
			'completed',
			'completed'
		]);
		expect(logs[0].hasWorkerIssue).toBe(false);
		expect(logs[0].durationMs).toBeLessThan(2 * 60_000);
		expect(logs[0].latestAttemptedLedger).toBe(58_584_000);
		expect(logs[0].currentRangeFromLedger).toBe(58_583_680);
		expect(logs[0].currentRangeToLedger).toBe(58_584_000);
		expect(logs[1].hasWorkerIssue).toBe(false);
		expect(logs[1].hasArchiveVerificationError).toBe(false);
		expect(logs[1].errors).toEqual([]);
		expect(logs[2].hasArchiveVerificationError).toBe(true);
		expect(logs[2].errors[0]?.message).toBe('Wrong transaction hash');
	});

	it('hides worker-only failures from public archive scan logs', async () => {
		const newerJob = new ScanJob(
			historyUrl.value,
			0,
			null,
			null,
			null,
			null,
			null,
			'6e2a0f88-6b73-44b0-8fd7-e061bc846ac2'
		);
		newerJob.status = 'PENDING';
		newerJob.createdAt = new Date('2026-07-05T00:00:00.000Z');
		newerJob.updatedAt = new Date('2026-07-05T00:00:00.000Z');
		const resolvedWorkerOnlyFailure = createScan(
			new Date('2026-07-04T00:00:00.000Z'),
			24,
			new ScanError(
				ScanErrorType.TYPE_CONNECTION,
				`${historyUrl.value}/bucket/32/90/bucket.xdr.gz`,
				"EACCES: permission denied, mkdir '/home/observe/stellarbeat-data/Observer/history-bucket-cache/32/90'"
			)
		);
		const archiveVerificationFailure = createScan(
			new Date('2026-07-01T00:00:00.000Z'),
			24,
			new ScanError(
				ScanErrorType.TYPE_VERIFICATION,
				`${historyUrl.value}/transactions/03/80/a5/transactions-0380a53f.xdr.gz`,
				'Wrong transaction hash'
			)
		);

		scanJobRepositoryMock.findActiveByUrl.mockResolvedValue([newerJob]);
		scanRepositoryMock.findRecentByUrl.mockResolvedValue([
			resolvedWorkerOnlyFailure,
			archiveVerificationFailure
		]);

		const result = await getScanLogs.execute(historyUrl.value);

		expect(result.isOk()).toBe(true);
		const logs = result._unsafeUnwrap();
		expect(logs).toHaveLength(2);
		expect(logs[0].hasArchiveVerificationError).toBe(true);
		expect(logs[1].status).toBe('queued');
		expect(
			logs.some((log) => log.hasWorkerIssue && log.status === 'completed')
		).toBe(false);
	});

	it('reports claimed jobs without scanner settings as starting with unknown concurrency', async () => {
		const startingJob = new ScanJob(
			historyUrl.value,
			58_583_679,
			null,
			new Date('2026-07-03T00:00:00.000Z'),
			58_583_680,
			null,
			null,
			'6e2a0f88-6b73-44b0-8fd7-e061bc846ac2'
		);
		startingJob.status = 'TAKEN';
		startingJob.createdAt = new Date(Date.now() - 60_000);
		startingJob.updatedAt = new Date(Date.now() - 30_000);

		scanJobRepositoryMock.findActiveByUrl.mockResolvedValue([startingJob]);
		scanRepositoryMock.findRecentByUrl.mockResolvedValue([]);

		const result = await getScanLogs.execute(historyUrl.value);

		expect(result.isOk()).toBe(true);
		const logs = result._unsafeUnwrap();
		expect(logs).toHaveLength(1);
		expect(logs[0]).toMatchObject({
			status: 'starting',
			concurrency: null,
			hasArchiveVerificationError: false,
			hasWorkerIssue: false
		});
	});

	it('strips worker issues from mixed completed scans', async () => {
		const workerOnlyFailure = createScan(
			new Date('2026-07-04T00:00:00.000Z'),
			24,
			new ScanError(
				ScanErrorType.TYPE_CONNECTION,
				`${historyUrl.value}/bucket/32/90/bucket.xdr.gz`,
				"EACCES: permission denied, mkdir '/home/observe/stellarbeat-data/Observer/history-bucket-cache/32/90'"
			)
		);
		const archiveVerificationFailure = createScan(
			new Date('2026-07-04T00:00:00.000Z'),
			24,
			new ScanError(
				ScanErrorType.TYPE_VERIFICATION,
				`${historyUrl.value}/transactions/03/80/a5/transactions-0380a53f.xdr.gz`,
				'Wrong transaction hash'
			),
			new ScanError(
				ScanErrorType.TYPE_CONNECTION,
				`${historyUrl.value}/history/03/80/a5/history-0380a53f.json`,
				'HTTP timeout'
			)
		);

		scanJobRepositoryMock.findActiveByUrl.mockResolvedValue([]);
		scanRepositoryMock.findRecentByUrl.mockResolvedValue([
			workerOnlyFailure,
			archiveVerificationFailure
		]);

		const result = await getScanLogs.execute(historyUrl.value);

		expect(result.isOk()).toBe(true);
		const logs = result._unsafeUnwrap();
		expect(logs).toHaveLength(1);
		expect(logs[0].hasArchiveVerificationError).toBe(true);
		expect(logs[0].hasWorkerIssue).toBe(false);
		expect(logs[0].errors).toHaveLength(1);
		expect(logs[0].errors[0]?.message).toBe('Wrong transaction hash');
	});

	function createScan(
		startDate: Date,
		concurrency: number,
		error: ScanError | null,
		...additionalErrors: readonly ScanError[]
	): Scan {
		const errors = error ? [error, ...additionalErrors] : additionalErrors;
		return new Scan(
			new Date('2026-01-01T00:00:00.000Z'),
			startDate,
			new Date(startDate.getTime() + 60_000),
			historyUrl,
			58_583_680,
			61_972_287,
			58_583_679,
			null,
			concurrency,
			false,
			error,
			errors
		);
	}
});
