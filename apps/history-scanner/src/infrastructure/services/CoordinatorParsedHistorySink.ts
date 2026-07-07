import {
	ParsedLedgerHeaderBatchDTO,
	ParsedTransactionEnvelopeBatchDTO,
	ParsedTransactionResultBatchDTO,
	type ParsedLedgerHeaderDTO,
	type ParsedTransactionEnvelopeDTO,
	type ParsedTransactionResultDTO
} from 'history-scanner-dto';
import type { ExceptionLogger } from 'exception-logger';
import type { Result } from 'neverthrow';
import type { ScanCoordinatorService } from '../../domain/scan/ScanCoordinatorService.js';
import type {
	ParsedHistoryRecord,
	ParsedHistorySink,
	ParsedLedgerHeaderRecord,
	ParsedTransactionEnvelopeRecord,
	ParsedTransactionResultRecord
} from '../../domain/scanner/parsed-history/ParsedHistorySink.js';
import { asyncSleep } from 'shared';

export class CoordinatorParsedHistorySink implements ParsedHistorySink {
	private readonly headers: ParsedLedgerHeaderDTO[] = [];
	private readonly envelopes: ParsedTransactionEnvelopeDTO[] = [];
	private readonly results: ParsedTransactionResultDTO[] = [];
	private static readonly defaultRetryDelaysMs = [250, 500, 1000, 2000];

	constructor(
		private readonly coordinator: ScanCoordinatorService,
		private readonly sourceArchiveUrl: string,
		private readonly scanJobRemoteId: string,
		private readonly exceptionLogger: ExceptionLogger,
		private readonly batchSize = 50,
		private readonly retryDelaysMs: readonly number[] = CoordinatorParsedHistorySink.defaultRetryDelaysMs
	) {}

	async emit(record: ParsedHistoryRecord): Promise<void> {
		if (record.recordType === 'ledger-header') {
			this.headers.push(this.toHeaderDTO(record));
			if (this.headers.length >= this.batchSize) await this.flushHeaders();
			return;
		}

		if (record.recordType === 'transaction-envelope') {
			this.envelopes.push(this.toEnvelopeDTO(record));
			if (this.envelopes.length >= this.batchSize) await this.flushEnvelopes();
			return;
		}

		this.results.push(this.toResultDTO(record));
		if (this.results.length >= this.batchSize) await this.flushResults();
	}

	async flush(): Promise<void> {
		await this.flushHeaders();
		await this.flushEnvelopes();
		await this.flushResults();
	}

	private async flushHeaders(): Promise<void> {
		if (this.headers.length === 0) return;

		const batch = new ParsedLedgerHeaderBatchDTO(
			this.sourceArchiveUrl,
			this.scanJobRemoteId,
			new Date(),
			this.headers.splice(0, this.headers.length)
		);
		const result = await this.registerHeadersWithRetry(batch);
		if (result !== null) this.exceptionLogger.captureException(result);
	}

	private async flushEnvelopes(): Promise<void> {
		if (this.envelopes.length === 0) return;

		const batch = new ParsedTransactionEnvelopeBatchDTO(
			this.sourceArchiveUrl,
			this.scanJobRemoteId,
			new Date(),
			this.envelopes.splice(0, this.envelopes.length)
		);
		const result = await this.registerEnvelopesWithRetry(batch);
		if (result !== null) this.exceptionLogger.captureException(result);
	}

	private async flushResults(): Promise<void> {
		if (this.results.length === 0) return;

		const batch = new ParsedTransactionResultBatchDTO(
			this.sourceArchiveUrl,
			this.scanJobRemoteId,
			new Date(),
			this.results.splice(0, this.results.length)
		);
		const result = await this.registerResultsWithRetry(batch);
		if (result !== null) this.exceptionLogger.captureException(result);
	}

	private async registerHeadersWithRetry(
		batch: ParsedLedgerHeaderBatchDTO
	): Promise<Error | null> {
		return this.retry(() =>
			this.coordinator.registerParsedLedgerHeaders(batch)
		);
	}

	private async registerEnvelopesWithRetry(
		batch: ParsedTransactionEnvelopeBatchDTO
	): Promise<Error | null> {
		return this.retry(() =>
			this.coordinator.registerParsedTransactionEnvelopes(batch)
		);
	}

	private async registerResultsWithRetry(
		batch: ParsedTransactionResultBatchDTO
	): Promise<Error | null> {
		return this.retry(() =>
			this.coordinator.registerParsedTransactionResults(batch)
		);
	}

	private async retry(
		action: () => Promise<Result<void, Error>>
	): Promise<Error | null> {
		let lastError: Error | null = null;
		for (let attempt = 0; attempt <= this.retryDelaysMs.length; attempt++) {
			const result = await action();
			if (result.isOk()) return null;
			lastError = result.error;

			const delay = this.retryDelaysMs[attempt];
			if (delay !== undefined) await asyncSleep(delay);
		}

		return lastError;
	}

	private toHeaderDTO(record: ParsedLedgerHeaderRecord): ParsedLedgerHeaderDTO {
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

	private toEnvelopeDTO(
		record: ParsedTransactionEnvelopeRecord
	): ParsedTransactionEnvelopeDTO {
		return {
			envelopeXdr: record.envelopeXdr,
			ledgerSequence: record.ledger,
			transactionIndex: record.transactionIndex,
			transactionSetHash: record.transactionSetHash
		};
	}

	private toResultDTO(
		record: ParsedTransactionResultRecord
	): ParsedTransactionResultDTO {
		return {
			ledgerSequence: record.ledger,
			resultXdr: record.resultXdr,
			transactionHash: record.transactionHash,
			transactionIndex: record.transactionIndex,
			transactionResultHash: record.transactionResultHash
		};
	}
}
