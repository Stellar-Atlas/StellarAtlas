import {
	ParsedLedgerHeaderBatchDTO,
	type ParsedLedgerHeaderDTO
} from 'history-scanner-dto';
import type { ExceptionLogger } from 'exception-logger';
import type { ScanCoordinatorService } from '../../domain/scan/ScanCoordinatorService.js';
import type {
	ParsedHistoryRecord,
	ParsedHistorySink,
	ParsedLedgerHeaderRecord
} from '../../domain/scanner/parsed-history/ParsedHistorySink.js';

export class CoordinatorParsedHistorySink implements ParsedHistorySink {
	private readonly headers: ParsedLedgerHeaderDTO[] = [];

	constructor(
		private readonly coordinator: ScanCoordinatorService,
		private readonly sourceArchiveUrl: string,
		private readonly scanJobRemoteId: string,
		private readonly exceptionLogger: ExceptionLogger,
		private readonly batchSize = 500
	) {}

	async emit(record: ParsedHistoryRecord): Promise<void> {
		if (record.recordType !== 'ledger-header') return;

		this.headers.push(this.toHeaderDTO(record));
		if (this.headers.length >= this.batchSize) await this.flush();
	}

	async flush(): Promise<void> {
		if (this.headers.length === 0) return;

		const batch = new ParsedLedgerHeaderBatchDTO(
			this.sourceArchiveUrl,
			this.scanJobRemoteId,
			new Date(),
			this.headers.splice(0, this.headers.length)
		);
		const result = await this.coordinator.registerParsedLedgerHeaders(batch);
		if (result.isErr()) this.exceptionLogger.captureException(result.error);
	}

	private toHeaderDTO(
		record: ParsedLedgerHeaderRecord
	): ParsedLedgerHeaderDTO {
		return {
			bucketListHash: record.bucketListHash,
			ledgerHeaderHash: record.ledgerHeaderHash,
			ledgerSequence: record.ledger,
			previousLedgerHeaderHash: record.previousLedgerHeaderHash,
			protocolVersion: record.protocolVersion,
			transactionResultHash: record.transactionResultSetHash,
			transactionSetHash: record.transactionSetHash
		};
	}
}
