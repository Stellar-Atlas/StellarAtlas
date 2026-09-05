import {
	ParsedLedgerHeaderBatchDTO,
	ParsedTransactionEnvelopeBatchDTO,
	ParsedTransactionResultBatchDTO,
	parsedHistoryBatchPayloadLimitBytes,
	parsedHistoryMaximumBatchRecords,
	parsedHistoryRequestBodyLimitBytes,
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
import { ScannerIssueError } from '../../domain/scanner/ScannerIssueError.js';
import { ParsedHistoryRegistrationConflictError } from './ParsedHistoryRegistrationConflictError.js';

export interface CoordinatorParsedHistorySinkOptions {
	readonly deferWritesUntilFlush?: boolean;
	readonly maxPayloadBytes?: number;
	readonly maxRecordsPerBatch?: number;
	readonly retryDelaysMs?: readonly number[];
}

interface BufferedBatch<RecordType extends object> {
	readonly pending: RecordType[][];
	readonly records: RecordType[];
	readonly emptyPayloadBytes: number;
	payloadBytes: number;
}

export class CoordinatorParsedHistorySink implements ParsedHistorySink {
	private static readonly defaultRetryDelaysMs = [250, 500, 1000, 2000];
	private readonly headers: BufferedBatch<ParsedLedgerHeaderDTO>;
	private readonly envelopes: BufferedBatch<ParsedTransactionEnvelopeDTO>;
	private readonly results: BufferedBatch<ParsedTransactionResultDTO>;
	private readonly deferWritesUntilFlush: boolean;
	private readonly maxPayloadBytes: number;
	private readonly maxRecordsPerBatch: number;
	private readonly retryDelaysMs: readonly number[];

	constructor(
		private readonly coordinator: ScanCoordinatorService,
		private readonly sourceArchiveUrl: string,
		private readonly scanJobRemoteId: string,
		private readonly exceptionLogger: ExceptionLogger,
		options: CoordinatorParsedHistorySinkOptions = {}
	) {
		this.deferWritesUntilFlush = options.deferWritesUntilFlush ?? false;
		this.maxPayloadBytes =
			options.maxPayloadBytes ?? parsedHistoryBatchPayloadLimitBytes;
		this.maxRecordsPerBatch =
			options.maxRecordsPerBatch ?? parsedHistoryMaximumBatchRecords;
		this.retryDelaysMs =
			options.retryDelaysMs ??
			CoordinatorParsedHistorySink.defaultRetryDelaysMs;
		this.assertOptions();
		this.headers = this.createBuffer((records) =>
			this.createHeaderBatch(records)
		);
		this.envelopes = this.createBuffer((records) =>
			this.createEnvelopeBatch(records)
		);
		this.results = this.createBuffer((records) =>
			this.createResultBatch(records)
		);
	}

	async emit(record: ParsedHistoryRecord): Promise<void> {
		if (record.recordType === 'ledger-header') {
			await this.appendHeader(this.toHeaderDTO(record));
			return;
		}

		if (record.recordType === 'transaction-envelope') {
			await this.appendEnvelope(this.toEnvelopeDTO(record));
			return;
		}

		await this.appendResult(this.toResultDTO(record));
	}

	async flush(): Promise<void> {
		await this.flushHeaders();
		await this.flushEnvelopes();
		await this.flushResults();
	}

	private async flushHeaders(): Promise<void> {
		this.stage(this.headers);
		while (this.headers.pending.length > 0) {
			const batch = this.createHeaderBatch(this.headers.pending[0]!);
			this.assertPayloadBound(batch);
			const result = await this.registerHeadersWithRetry(batch);
			this.throwRegistrationFailure(result);
			this.headers.pending.shift();
		}
	}

	private async flushEnvelopes(): Promise<void> {
		this.stage(this.envelopes);
		while (this.envelopes.pending.length > 0) {
			const batch = this.createEnvelopeBatch(this.envelopes.pending[0]!);
			this.assertPayloadBound(batch);
			const result = await this.registerEnvelopesWithRetry(batch);
			this.throwRegistrationFailure(result);
			this.envelopes.pending.shift();
		}
	}

	private async flushResults(): Promise<void> {
		this.stage(this.results);
		while (this.results.pending.length > 0) {
			const batch = this.createResultBatch(this.results.pending[0]!);
			this.assertPayloadBound(batch);
			const result = await this.registerResultsWithRetry(batch);
			this.throwRegistrationFailure(result);
			this.results.pending.shift();
		}
	}

	private async appendHeader(record: ParsedLedgerHeaderDTO): Promise<void> {
		await this.append(this.headers, record, () => this.flushHeaders());
	}

	private async appendEnvelope(
		record: ParsedTransactionEnvelopeDTO
	): Promise<void> {
		await this.append(this.envelopes, record, () => this.flushEnvelopes());
	}

	private async appendResult(
		record: ParsedTransactionResultDTO
	): Promise<void> {
		await this.append(this.results, record, () => this.flushResults());
	}

	private async append<RecordType extends object>(
		buffer: BufferedBatch<RecordType>,
		record: RecordType,
		flush: () => Promise<void>
	): Promise<void> {
		const recordBytes = this.payloadSize(record);
		if (buffer.emptyPayloadBytes + recordBytes > this.maxPayloadBytes) {
			throw new ScannerIssueError(
				'Parsed history record exceeds the configured payload limit'
			);
		}

		const separatorBytes = buffer.records.length === 0 ? 0 : 1;
		if (
			buffer.records.length > 0 &&
			buffer.payloadBytes + separatorBytes + recordBytes > this.maxPayloadBytes
		) {
			if (this.deferWritesUntilFlush) this.stage(buffer);
			else await flush();
		}

		buffer.payloadBytes += (buffer.records.length === 0 ? 0 : 1) + recordBytes;
		buffer.records.push(record);
		if (buffer.records.length >= this.maxRecordsPerBatch) {
			if (this.deferWritesUntilFlush) this.stage(buffer);
			else await flush();
		}
	}

	private createHeaderBatch(
		headers: readonly ParsedLedgerHeaderDTO[]
	): ParsedLedgerHeaderBatchDTO {
		return new ParsedLedgerHeaderBatchDTO(
			this.sourceArchiveUrl,
			this.scanJobRemoteId,
			new Date(),
			[...headers]
		);
	}

	private createEnvelopeBatch(
		records: readonly ParsedTransactionEnvelopeDTO[]
	): ParsedTransactionEnvelopeBatchDTO {
		return new ParsedTransactionEnvelopeBatchDTO(
			this.sourceArchiveUrl,
			this.scanJobRemoteId,
			new Date(),
			[...records]
		);
	}

	private createResultBatch(
		records: readonly ParsedTransactionResultDTO[]
	): ParsedTransactionResultBatchDTO {
		return new ParsedTransactionResultBatchDTO(
			this.sourceArchiveUrl,
			this.scanJobRemoteId,
			new Date(),
			[...records]
		);
	}

	private createBuffer<RecordType extends object>(
		createBatch: (records: readonly RecordType[]) => object
	): BufferedBatch<RecordType> {
		const emptyPayloadBytes = this.payloadSize(createBatch([]));
		return {
			emptyPayloadBytes,
			payloadBytes: emptyPayloadBytes,
			pending: [],
			records: []
		};
	}

	private stage<RecordType extends object>(
		buffer: BufferedBatch<RecordType>
	): void {
		if (buffer.records.length > 0) buffer.pending.push(this.drain(buffer));
	}

	private drain<RecordType extends object>(
		buffer: BufferedBatch<RecordType>
	): RecordType[] {
		const records = buffer.records.splice(0, buffer.records.length);
		buffer.payloadBytes = buffer.emptyPayloadBytes;
		return records;
	}

	private assertPayloadBound(batch: object): void {
		if (this.payloadSize(batch) <= this.maxPayloadBytes) return;
		throw new ScannerIssueError(
			'Parsed history batch exceeds the configured payload limit'
		);
	}

	private assertOptions(): void {
		assertIntegerInRange(
			this.maxRecordsPerBatch,
			1,
			parsedHistoryMaximumBatchRecords,
			'maxRecordsPerBatch'
		);
		assertIntegerInRange(
			this.maxPayloadBytes,
			1,
			parsedHistoryRequestBodyLimitBytes,
			'maxPayloadBytes'
		);
		for (const retryDelayMs of this.retryDelaysMs) {
			assertIntegerInRange(
				retryDelayMs,
				0,
				Number.MAX_SAFE_INTEGER,
				'retryDelayMs'
			);
		}
	}

	private payloadSize(payload: object): number {
		return Buffer.byteLength(JSON.stringify(payload), 'utf8');
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
			if (lastError instanceof ParsedHistoryRegistrationConflictError) {
				return lastError;
			}

			const delay = this.retryDelaysMs[attempt];
			if (delay !== undefined) await asyncSleep(this.jitter(delay));
		}

		return lastError;
	}

	private jitter(delayMs: number): number {
		const spread = Math.max(1, Math.floor(delayMs / 4));
		return delayMs + Math.floor(Math.random() * spread);
	}

	private throwRegistrationFailure(error: Error | null): void {
		if (error === null) return;
		if (error instanceof ParsedHistoryRegistrationConflictError) throw error;
		this.exceptionLogger.captureException(error);
		throw new ScannerIssueError('Parsed history sink failed', { cause: error });
	}

	private toHeaderDTO(record: ParsedLedgerHeaderRecord): ParsedLedgerHeaderDTO {
		return {
			bucketListHash: record.bucketListHash,
			closedAt: record.closedAt,
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

function assertIntegerInRange(
	value: number,
	minimum: number,
	maximum: number,
	name: string
): void {
	if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
		throw new RangeError(`${name} must be between ${minimum} and ${maximum}`);
	}
}
