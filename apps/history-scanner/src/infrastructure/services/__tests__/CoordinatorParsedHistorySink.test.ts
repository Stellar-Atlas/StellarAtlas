import { mock } from 'jest-mock-extended';
import { err, ok } from 'neverthrow';
import type { ExceptionLogger } from 'exception-logger';
import type { ScanCoordinatorService } from '../../../domain/scan/ScanCoordinatorService.js';
import { CoordinatorParsedHistorySink } from '../CoordinatorParsedHistorySink.js';
import { ParsedHistoryRegistrationConflictError } from '../ParsedHistoryRegistrationConflictError.js';

describe('CoordinatorParsedHistorySink', () => {
	it('should batch and flush parsed ledger header records', async () => {
		const coordinator = mock<ScanCoordinatorService>();
		const exceptionLogger = mock<ExceptionLogger>();
		coordinator.registerParsedLedgerHeaders.mockResolvedValue(ok(undefined));
		coordinator.registerParsedTransactionEnvelopes.mockResolvedValue(
			ok(undefined)
		);
		coordinator.registerParsedTransactionResults.mockResolvedValue(
			ok(undefined)
		);
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
		expect(
			coordinator.registerParsedLedgerHeaders.mock.calls[0][0].headers[0]
		).toMatchObject({ closedAt: '2026-07-05T01:42:50.000Z' });

		await sink.emit(createLedgerHeaderRecord(3));
		await sink.flush();

		expect(coordinator.registerParsedLedgerHeaders).toHaveBeenCalledTimes(2);
		expect(
			coordinator.registerParsedLedgerHeaders.mock.calls[1][0].headers
		).toHaveLength(1);
		expect(exceptionLogger.captureException).not.toHaveBeenCalled();
	});

	it('should retry short coordinator failures before logging an error', async () => {
		const coordinator = mock<ScanCoordinatorService>();
		const exceptionLogger = mock<ExceptionLogger>();
		coordinator.registerParsedLedgerHeaders
			.mockResolvedValueOnce(err(new Error('ECONNREFUSED')))
			.mockResolvedValueOnce(ok(undefined));
		coordinator.registerParsedTransactionEnvelopes.mockResolvedValue(
			ok(undefined)
		);
		coordinator.registerParsedTransactionResults.mockResolvedValue(
			ok(undefined)
		);
		const sink = new CoordinatorParsedHistorySink(
			coordinator,
			'https://history.stellar.org',
			'remote-id',
			exceptionLogger,
			1,
			[0]
		);

		await sink.emit(createLedgerHeaderRecord(1));

		expect(coordinator.registerParsedLedgerHeaders).toHaveBeenCalledTimes(2);
		expect(exceptionLogger.captureException).not.toHaveBeenCalled();
	});

	it('should preserve archive content conflicts without retrying or logging them', async () => {
		const coordinator = mock<ScanCoordinatorService>();
		const exceptionLogger = mock<ExceptionLogger>();
		const conflict = new ParsedHistoryRegistrationConflictError(
			'Parsed ledger header content conflicts with its stored identity',
			'stored-value-conflict',
			[{ ledgerHeaderHash: 'ledger-header-1', ledgerSequence: 1 }]
		);
		coordinator.registerParsedLedgerHeaders.mockResolvedValue(err(conflict));
		const sink = new CoordinatorParsedHistorySink(
			coordinator,
			'https://history.stellar.org',
			'remote-id',
			exceptionLogger,
			1,
			[0, 0]
		);

		await expect(sink.emit(createLedgerHeaderRecord(1))).rejects.toBe(conflict);

		expect(coordinator.registerParsedLedgerHeaders).toHaveBeenCalledTimes(1);
		expect(exceptionLogger.captureException).not.toHaveBeenCalled();
	});

	it('should batch parsed transaction envelopes and results independently', async () => {
		const coordinator = mock<ScanCoordinatorService>();
		const exceptionLogger = mock<ExceptionLogger>();
		coordinator.registerParsedLedgerHeaders.mockResolvedValue(ok(undefined));
		coordinator.registerParsedTransactionEnvelopes.mockResolvedValue(
			ok(undefined)
		);
		coordinator.registerParsedTransactionResults.mockResolvedValue(
			ok(undefined)
		);
		const sink = new CoordinatorParsedHistorySink(
			coordinator,
			'https://history.stellar.org',
			'remote-id',
			exceptionLogger,
			2
		);

		await sink.emit(createTransactionEnvelopeRecord(1, 0));
		await sink.emit(createTransactionResultRecord(1, 0));
		expect(
			coordinator.registerParsedTransactionEnvelopes
		).not.toHaveBeenCalled();
		expect(coordinator.registerParsedTransactionResults).not.toHaveBeenCalled();

		await sink.emit(createTransactionEnvelopeRecord(1, 1));
		await sink.emit(createTransactionResultRecord(1, 1));

		expect(
			coordinator.registerParsedTransactionEnvelopes
		).toHaveBeenCalledTimes(1);
		expect(coordinator.registerParsedTransactionResults).toHaveBeenCalledTimes(
			1
		);
		expect(
			coordinator.registerParsedTransactionEnvelopes.mock.calls[0][0].records
		).toHaveLength(2);
		expect(
			coordinator.registerParsedTransactionResults.mock.calls[0][0].records
		).toHaveLength(2);
		expect(exceptionLogger.captureException).not.toHaveBeenCalled();
	});

	it('should flush parsed transaction envelopes when payload size is capped', async () => {
		const coordinator = mock<ScanCoordinatorService>();
		const exceptionLogger = mock<ExceptionLogger>();
		coordinator.registerParsedLedgerHeaders.mockResolvedValue(ok(undefined));
		coordinator.registerParsedTransactionEnvelopes.mockResolvedValue(
			ok(undefined)
		);
		coordinator.registerParsedTransactionResults.mockResolvedValue(
			ok(undefined)
		);
		const sink = new CoordinatorParsedHistorySink(
			coordinator,
			'https://history.stellar.org',
			'remote-id',
			exceptionLogger,
			50,
			[0],
			1
		);

		await sink.emit(createTransactionEnvelopeRecord(1, 0));
		await sink.emit(createTransactionEnvelopeRecord(1, 1));

		expect(
			coordinator.registerParsedTransactionEnvelopes
		).toHaveBeenCalledTimes(2);
		expect(
			coordinator.registerParsedTransactionEnvelopes.mock.calls[0][0].records
		).toHaveLength(1);
		expect(
			coordinator.registerParsedTransactionEnvelopes.mock.calls[1][0].records
		).toHaveLength(1);
	});
});

function createLedgerHeaderRecord(ledger: number) {
	return {
		bucketListHash: `bucket-list-${ledger}`,
		closedAt: '2026-07-05T01:42:50.000Z',
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

function createTransactionEnvelopeRecord(
	ledger: number,
	transactionIndex: number
) {
	return {
		envelopeXdr: `envelope-${ledger}-${transactionIndex}`,
		ledger,
		recordType: 'transaction-envelope' as const,
		sourceUrl: 'https://history.stellar.org',
		transactionIndex,
		transactionSetHash: `transaction-set-${ledger}`
	};
}

function createTransactionResultRecord(
	ledger: number,
	transactionIndex: number
) {
	return {
		ledger,
		recordType: 'transaction-result' as const,
		resultXdr: `result-${ledger}-${transactionIndex}`,
		sourceUrl: 'https://history.stellar.org',
		transactionHash: `transaction-${ledger}-${transactionIndex}`,
		transactionIndex,
		transactionResultHash: `transaction-result-${ledger}`
	};
}
