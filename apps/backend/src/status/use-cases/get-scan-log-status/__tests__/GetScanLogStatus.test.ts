import { mock } from 'jest-mock-extended';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
import type { ScanRepository } from '@history-scan-coordinator/domain/scan/ScanRepository.js';
import NetworkScan from '@network-scan/domain/network/scan/NetworkScan.js';
import type { NetworkScanRepository } from '@network-scan/domain/network/scan/NetworkScanRepository.js';
import { GetScanLogStatus } from '../GetScanLogStatus.js';

describe('GetScanLogStatus', () => {
	it('should include archive scheduling counters on network scan logs', async () => {
		const networkScanRepository = mock<NetworkScanRepository>();
		const historyArchiveScanRepository = mock<ScanRepository>();
		const exceptionLogger = mock<ExceptionLogger>();
		const scan = new NetworkScan(new Date('2026-07-06T12:00:00.000Z'));
		scan.completed = true;
		scan.latestLedger = BigInt(63340848);
		scan.latestLedgerCloseTime = new Date('2026-07-06T11:59:45.000Z');
		scan.ledgers = [1, 2, 3];
		scan.historyArchiveSchedulingDiscoveredUrlCount = 4;
		scan.historyArchiveSchedulingScheduledCount = 2;
		scan.historyArchiveSchedulingDuplicateSuppressedCount = 1;
		scan.historyArchiveSchedulingErrorCount = 1;
		networkScanRepository.findRecent.mockResolvedValue([scan]);
		historyArchiveScanRepository.findRecentLimited.mockResolvedValue([]);
		const useCase = new GetScanLogStatus(
			networkScanRepository,
			historyArchiveScanRepository,
			exceptionLogger
		);

		const result = await useCase.execute(1);

		expect(result.isOk()).toBe(true);
		if (result.isErr()) fail(result.error);
		expect(result.value.networkScans[0]).toMatchObject({
			archiveScheduling: {
				discoveredArchiveUrlCount: 4,
				scheduledArchiveScanJobCount: 2,
				duplicateSuppressedArchiveScanJobCount: 1,
				schedulerErrorCount: 1
			},
			status: 'ok'
		});
		expect(exceptionLogger.captureException).not.toHaveBeenCalled();
	});
});
