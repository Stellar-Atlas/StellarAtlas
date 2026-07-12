import type { ParsedLedgerHeaderBatchDTO } from 'history-scanner-dto';

export interface ParsedLedgerHeaderWatermark {
	readonly earliestLedgerSequence: number | null;
	readonly latestLedgerHeaderHash: string | null;
	readonly latestLedgerSequence: number | null;
	readonly latestObservedAt: Date | null;
	readonly parsedLedgerCount: number;
	readonly sourceArchiveCount: number;
}

export interface ParsedLedgerHeaderDetails {
	readonly bucketListHash: string;
	readonly closedAt: Date | null;
	readonly closedAtObservedAt: Date | null;
	readonly closedAtScanJobRemoteId: string | null;
	readonly closedAtSourceArchiveUrl: string | null;
	readonly firstSeenAt: Date;
	readonly firstSourceArchiveUrl: string;
	readonly ledgerHeaderHash: string;
	readonly ledgerSequence: number;
	readonly lastScanJobRemoteId: string;
	readonly lastSeenAt: Date;
	readonly lastSourceArchiveUrl: string;
	readonly previousLedgerHeaderHash: string;
	readonly protocolVersion: number;
	readonly transactionResultHash: string;
	readonly transactionSetHash: string;
}

export interface ParsedLedgerHeaderObjectObservation {
	readonly bucketListHash: string;
	readonly closedAt: Date | null;
	readonly ledgerHeaderHash: string;
	readonly ledgerSequence: number;
	readonly previousLedgerHeaderHash: string;
	readonly protocolVersion: number;
	readonly transactionResultHash: string;
	readonly transactionSetHash: string;
}

export interface ParsedLedgerHeaderSourceRange {
	readonly archiveUrl: string;
	readonly earliestLedgerSequence: number;
	readonly latestLedgerSequence: number;
	readonly latestObservedAt: Date;
	readonly parsedLedgerCount: number;
}

export interface ParsedLedgerHeaderRepository {
	/**
	 * Staging/status lookup only. This deterministic candidate is not proof-gated
	 * and must never be promoted as canonical without an exact hash lookup.
	 */
	findByLedgerSequence(
		ledgerSequence: number
	): Promise<ParsedLedgerHeaderDetails | null>;
	/**
	 * Returns one exact staging identity for comparison with checkpoint proof and
	 * source-object digests. The caller remains responsible for proof validation.
	 */
	findByLedgerSequenceAndHash(
		ledgerSequence: number,
		ledgerHeaderHash: string
	): Promise<ParsedLedgerHeaderDetails | null>;
	/** Returns only rows observed while processing the exact archive object. */
	findBySourceObjectRemoteId(
		sourceObjectRemoteId: string
	): Promise<ParsedLedgerHeaderObjectObservation[]>;
	findSourceRanges(limit: number): Promise<ParsedLedgerHeaderSourceRange[]>;
	getWatermark(): Promise<ParsedLedgerHeaderWatermark>;
	saveBatch(batch: ParsedLedgerHeaderBatchDTO): Promise<void>;
}
