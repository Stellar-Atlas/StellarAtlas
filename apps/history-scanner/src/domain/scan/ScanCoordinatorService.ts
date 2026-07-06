import { Result } from 'neverthrow';
import { Scan } from './Scan.js';
import {
	type ArchiveMetadataDTO,
	type ParsedLedgerHeaderBatchDTO,
	ScanJobDTO
} from 'history-scanner-dto';

export interface ScanJobProgressDTO {
	readonly concurrency?: number;
	readonly currentRangeFromLedger?: number | null;
	readonly currentRangeToLedger?: number | null;
	readonly fromLedger?: number;
	readonly latestAttemptedLedger?: number;
	readonly latestScannedLedger?: number;
	readonly latestScannedLedgerHeaderHash?: string | null;
	readonly toLedger?: number | null;
}

export interface HistoryArchiveObjectJobDTO {
	readonly archiveUrl: string;
	readonly bucketHash: string | null;
	readonly checkpointLedger: number | null;
	readonly claimAttempt: number;
	readonly objectKey: string;
	readonly objectType: string;
	readonly objectUrl: string;
	readonly remoteId: string;
}

export interface HistoryArchiveObjectProgressDTO {
	readonly bytesDownloaded?: number | null;
	readonly claimAttempt?: number;
	readonly workerStage?: string | null;
}

export interface HistoryArchiveObjectCompletionDTO
	extends HistoryArchiveObjectProgressDTO {
	readonly archiveMetadata?: ArchiveMetadataDTO;
}

export interface HistoryArchiveObjectFailureDTO {
	readonly claimAttempt?: number;
	readonly errorMessage: string;
	readonly errorType: string;
	readonly httpStatus?: number | null;
}

export interface ScanCoordinatorService {
	registerScan(scan: Scan): Promise<Result<void, Error>>;
	registerParsedLedgerHeaders(
		batch: ParsedLedgerHeaderBatchDTO
	): Promise<Result<void, Error>>;
	getScanJob(): Promise<Result<ScanJobDTO | null, Error>>;
	releaseScanJob(remoteId: string): Promise<Result<void, Error>>;
	touchScanJob(
		remoteId: string,
		progress?: ScanJobProgressDTO
	): Promise<Result<void, Error>>;
	getHistoryArchiveObjectJob(): Promise<
		Result<HistoryArchiveObjectJobDTO | null, Error>
	>;
	touchHistoryArchiveObject(
		remoteId: string,
		progress?: HistoryArchiveObjectProgressDTO
	): Promise<Result<void, Error>>;
	completeHistoryArchiveObject(
		remoteId: string,
		completion: HistoryArchiveObjectCompletionDTO
	): Promise<Result<void, Error>>;
	failHistoryArchiveObject(
		remoteId: string,
		failure: HistoryArchiveObjectFailureDTO
	): Promise<Result<void, Error>>;
	releaseHistoryArchiveObject(
		remoteId: string,
		claimAttempt: number
	): Promise<Result<void, Error>>;
}
