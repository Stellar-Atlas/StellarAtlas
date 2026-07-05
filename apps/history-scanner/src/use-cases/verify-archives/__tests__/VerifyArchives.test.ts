import { mock, type MockProxy } from 'jest-mock-extended';
import { VerifyArchives } from '../VerifyArchives.js';
import { Scanner } from '@domain/scanner/Scanner.js';
import type { ScanCoordinatorService } from '@domain/scan/ScanCoordinatorService.js';
import type { ExceptionLogger } from 'exception-logger';
import type { JobMonitor } from 'job-monitor';
import { ok, err } from 'neverthrow';
import { ScanJobDTO } from 'history-scanner-dto';
import { Scan } from '@domain/scan/Scan.js';
import { Url } from 'http-helper';

class TestVerifyArchives extends VerifyArchives {
	public readonly retryWaits: number[] = [];

	protected override async waitBeforeRetry(): Promise<void> {
		this.retryWaits.push(60 * 1000);
	}
}

describe('VerifyArchives', () => {
	let verifyArchives: TestVerifyArchives;
	let scannerMock: MockProxy<Scanner>;
	let scanCoordinatorMock: MockProxy<ScanCoordinatorService>;
	let exceptionLoggerMock: MockProxy<ExceptionLogger>;
	let jobMonitorMock: MockProxy<JobMonitor>;

	const mockScanJobDTO: ScanJobDTO = new ScanJobDTO(
		'https://example.com',
		0,
		null,
		null,
		'test'
	);

	beforeEach(() => {
		scannerMock = mock<Scanner>();
		scanCoordinatorMock = mock<ScanCoordinatorService>();
		scanCoordinatorMock.touchScanJob.mockResolvedValue(ok(undefined));
		scanCoordinatorMock.releaseScanJob.mockResolvedValue(ok(undefined));
		scanCoordinatorMock.registerParsedLedgerHeaders.mockResolvedValue(
			ok(undefined)
		);
		exceptionLoggerMock = mock<ExceptionLogger>();
		jobMonitorMock = mock<JobMonitor>();

		verifyArchives = new TestVerifyArchives(
			scannerMock,
			scanCoordinatorMock,
			exceptionLoggerMock,
			jobMonitorMock,
			1
		);
	});

	it('should handle successful scan job execution', async () => {
		scanCoordinatorMock.getScanJob.mockResolvedValue(ok(mockScanJobDTO));
		scannerMock.perform.mockResolvedValue(
			new Scan(
				new Date(),
				new Date(),
				new Date(),
				Url.create('https://example.com')._unsafeUnwrap(),
				0,
				100
			)
		);
		jobMonitorMock.checkIn.mockResolvedValue(ok(undefined));

		await verifyArchives.execute({ persist: false, loop: false });

		expect(scanCoordinatorMock.getScanJob).toHaveBeenCalledTimes(1);
		expect(jobMonitorMock.checkIn).toHaveBeenCalled();
		expect(scanCoordinatorMock.touchScanJob).toHaveBeenCalledTimes(1);
		expect(scanCoordinatorMock.releaseScanJob).toHaveBeenCalledWith('test');
		expect(exceptionLoggerMock.captureException).not.toHaveBeenCalled();
		expect(scannerMock.perform).toHaveBeenCalled();
	});

	it('should handle coordinator error and sleep', async () => {
		const error = new Error('Coordinator error');
		scanCoordinatorMock.getScanJob.mockResolvedValue(err(error));

		await verifyArchives.execute({ persist: false, loop: false });

		expect(exceptionLoggerMock.captureException).toHaveBeenCalledWith(error);
		expect(verifyArchives.retryWaits).toEqual([60 * 1000]);
		expect(jobMonitorMock.checkIn).not.toHaveBeenCalled();
		expect(scannerMock.perform).not.toHaveBeenCalled();
	});

	it('should idle without reporting an error when no scan job is available', async () => {
		scanCoordinatorMock.getScanJob.mockResolvedValue(ok(null));

		await verifyArchives.execute({ persist: false, loop: false });

		expect(exceptionLoggerMock.captureException).not.toHaveBeenCalled();
		expect(verifyArchives.retryWaits).toEqual([60 * 1000]);
		expect(jobMonitorMock.checkIn).not.toHaveBeenCalled();
		expect(scannerMock.perform).not.toHaveBeenCalled();
	});

	it('should capture unexpected errors', async () => {
		const unexpectedError = new Error('Unexpected');
		scanCoordinatorMock.getScanJob.mockRejectedValue(unexpectedError);

		await verifyArchives.execute({ persist: false, loop: false });

		expect(exceptionLoggerMock.captureException).toHaveBeenCalled();
		expect(verifyArchives.retryWaits).toEqual([60 * 1000]);
	});

	it('should respect persist flag', async () => {
		scanCoordinatorMock.getScanJob.mockResolvedValue(ok(mockScanJobDTO));
		scanCoordinatorMock.registerScan.mockResolvedValue(ok(undefined));
		jobMonitorMock.checkIn.mockResolvedValue(ok(undefined));
		scannerMock.perform.mockResolvedValue(
			new Scan(
				new Date(),
				new Date(),
				new Date(),
				Url.create('https://example.com')._unsafeUnwrap(),
				0,
				100
			)
		);

		await verifyArchives.execute({ persist: true, loop: false });

		expect(scanCoordinatorMock.registerScan).toHaveBeenCalled();
		expect(scannerMock.perform).toHaveBeenCalledWith(
			expect.any(Date),
			expect.anything(),
			expect.any(Object)
		);
		expect(scanCoordinatorMock.touchScanJob).toHaveBeenCalledTimes(1);
	});

	it('should release an unpersisted scan job after local execution', async () => {
		scanCoordinatorMock.getScanJob.mockResolvedValue(ok(mockScanJobDTO));
		jobMonitorMock.checkIn.mockResolvedValue(ok(undefined));
		scannerMock.perform.mockResolvedValue(
			new Scan(
				new Date(),
				new Date(),
				new Date(),
				Url.create('https://example.com')._unsafeUnwrap(),
				0,
				100
			)
		);

		await verifyArchives.execute({ persist: false, loop: false });

		expect(scanCoordinatorMock.registerScan).not.toHaveBeenCalled();
		expect(scanCoordinatorMock.touchScanJob).toHaveBeenCalledTimes(1);
		expect(scanCoordinatorMock.releaseScanJob).toHaveBeenCalledWith('test');
	});

	it('should handle persist errors', async () => {
		const error = new Error('Persist error');

		jobMonitorMock.checkIn.mockResolvedValue(ok(undefined));
		scanCoordinatorMock.getScanJob.mockResolvedValue(ok(mockScanJobDTO));
		scanCoordinatorMock.registerScan.mockRejectedValue(error);
		scannerMock.perform.mockResolvedValue(
			new Scan(
				new Date(),
				new Date(),
				new Date(),
				Url.create('https://example.com')._unsafeUnwrap(),
				0,
				100
			)
		);

		await verifyArchives.execute({ persist: true, loop: false });

		expect(exceptionLoggerMock.captureException).toHaveBeenCalledWith(error);
		expect(scanCoordinatorMock.releaseScanJob).toHaveBeenCalledWith('test');
		expect(verifyArchives.retryWaits).toEqual([60 * 1000]);
	});

	it('should claim and run jobs in parallel up to the configured worker count', async () => {
		const secondScanJobDTO = new ScanJobDTO(
			'https://example.org',
			0,
			null,
			null,
			'test-2'
		);
		verifyArchives = new TestVerifyArchives(
			scannerMock,
			scanCoordinatorMock,
			exceptionLoggerMock,
			jobMonitorMock,
			2
		);
		scanCoordinatorMock.getScanJob
			.mockResolvedValueOnce(ok(mockScanJobDTO))
			.mockResolvedValueOnce(ok(secondScanJobDTO));
		jobMonitorMock.checkIn.mockResolvedValue(ok(undefined));
		scannerMock.perform.mockResolvedValue(
			new Scan(
				new Date(),
				new Date(),
				new Date(),
				Url.create('https://example.com')._unsafeUnwrap(),
				0,
				100
			)
		);

		await verifyArchives.execute({ persist: false, loop: false });

		expect(scanCoordinatorMock.getScanJob).toHaveBeenCalledTimes(2);
		expect(scannerMock.perform).toHaveBeenCalledTimes(2);
	});
});
