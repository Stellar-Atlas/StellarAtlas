import { mock } from 'jest-mock-extended';
import { ok } from 'neverthrow';
import type { ExceptionLogger } from 'exception-logger';
import type { ScanCoordinatorService } from '../../../domain/scan/ScanCoordinatorService.js';
import { CoordinatorParsedHistorySink } from '../CoordinatorParsedHistorySink.js';

describe('CoordinatorParsedHistorySink', () => {
	it('should batch and flush parsed ledger header records', async () => {
		const coordinator = mock<ScanCoordinatorService>();
		const exceptionLogger = mock<ExceptionLogger>();
		coordinator.registerParsedLedgerHeaders.mockResolvedValue(ok(undefined));
		const sink = new CoordinatorParsedHistorySink(
			coordinator,
			'https://history.stellar.org',
			'remote-id',
			exceptionLogger,
			2
		);

		await sink.emit(createLedgerHeaderRecord(1));
		expect(coordinator.registerParsedLedgerHeaders).not.toHaveBeenCalled();

		await sink.emit(createLedgerHeaderRecord(2));
		expect(coordinator.registerParsedLedgerHeaders).toHaveBeenCalledTimes(1);
		expect(
			coordinator.registerParsedLedgerHeaders.mock.calls[0][0].headers
		).toHaveLength(2);

		await sink.emit(createLedgerHeaderRecord(3));
		await sink.flush();

		expect(coordinator.registerParsedLedgerHeaders).toHaveBeenCalledTimes(2);
		expect(
			coordinator.registerParsedLedgerHeaders.mock.calls[1][0].headers
		).toHaveLength(1);
		expect(exceptionLogger.captureException).not.toHaveBeenCalled();
	});
});

function createLedgerHeaderRecord(ledger: number) {
	return {
		bucketListHash: `bucket-list-${ledger}`,
		ledger,
		ledgerHeaderHash: `ledger-header-${ledger}`,
		previousLedgerHeaderHash: `previous-ledger-header-${ledger}`,
		protocolVersion: 23,
		recordType: 'ledger-header' as const,
		sourceUrl: 'https://history.stellar.org',
		transactionResultSetHash: `transaction-result-${ledger}`,
		transactionSetHash: `transaction-set-${ledger}`
	};
}
