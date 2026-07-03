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

	const historyUrlResult = Url.create('https://stellar-full-history2.bdnodes.net');
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

	it('hides completed worker-only setup failures from public scan logs', async () => {
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
		activeJob.createdAt = new Date('2026-07-03T01:00:00.000Z');
		activeJob.updatedAt = new Date('2026-07-03T01:01:00.000Z');

		const workerOnlyFailure = createScan(
			new Date('2026-07-01T13:23:00.000Z'),
			0,
			new ScanError(
				ScanErrorType.TYPE_CONNECTION,
				historyUrl.value,
				'Could not fetch latest ledger'
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

		scanJobRepositoryMock.findActiveByUrl.mockResolvedValue([activeJob]);
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
		expect(logs).toHaveLength(3);
		expect(logs.map((log) => log.status)).toEqual([
			'scanning',
			'completed',
			'completed'
		]);
		expect(
			logs.some((log) =>
				log.errors.some(
					(error) => error.message === 'Could not fetch latest ledger'
				)
			)
		).toBe(false);
		expect(logs[1].hasArchiveVerificationError).toBe(true);
		expect(logs[1].errors[0]?.message).toBe('Wrong transaction hash');
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
