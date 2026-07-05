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

	it('returns active jobs, stale jobs, archive errors, worker issues, and successes as distinct log entries', async () => {
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
		activeJob.status = 'TAKEN';
		activeJob.createdAt = new Date(now - 60_000);
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

		const workerOnlyFailure = createScan(
			new Date('2026-07-01T13:23:00.000Z'),
			0,
			new ScanError(
				ScanErrorType.TYPE_CONNECTION,
				historyUrl.value,
				"EACCES: permission denied, mkdir '/home/observe/stellarbeat-data/Observer/history-bucket-cache/32/90'"
			)
		);
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
			workerOnlyFailure,
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
		expect(logs).toHaveLength(5);
		expect(logs.map((log) => log.status)).toEqual([
			'scanning',
			'stale',
			'completed',
			'completed',
			'completed'
		]);
		expect(logs[0].hasWorkerIssue).toBe(false);
		expect(logs[1].hasWorkerIssue).toBe(true);
		expect(logs[1].hasArchiveVerificationError).toBe(false);
		expect(logs[1].errors[0]).toEqual({
			message: 'Scanner heartbeat is stale',
			type: 'TYPE_CONNECTION',
			url: historyUrl.value
		});
		expect(logs[2].hasWorkerIssue).toBe(true);
		expect(logs[2].hasArchiveVerificationError).toBe(false);
		expect(logs[2].errors[0]?.message).toBe(
			'EACCES: permission denied, mkdir [history bucket cache path]'
		);
		expect(logs[3].hasArchiveVerificationError).toBe(true);
		expect(logs[3].errors[0]?.message).toBe('Wrong transaction hash');
	});

	function createScan(
		startDate: Date,
		concurrency: number,
		error: ScanError | null
	): Scan {
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
			error
		);
	}
});
