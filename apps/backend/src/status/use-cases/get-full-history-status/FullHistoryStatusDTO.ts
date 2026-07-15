import type { StatusLevel } from '../../domain/StatusTypes.js';
import type { HistoricalFullHistoryBackfillDTO } from './HistoricalFullHistoryBackfillStatus.js';
import type { FullHistoryLedgerCloseMetaCoverageDTO } from './FullHistoryLedgerCloseMetaCoverage.js';
import type { FullHistoryLedgerCloseMetaStateStatusDTO } from './FullHistoryLedgerCloseMetaStateStatus.js';
import type { CanonicalFullHistoryCoverageDTO } from '@history-scan-coordinator/use-cases/get-full-history-canonical-coverage/FullHistoryCanonicalCoverageDTO.js';

export type { CanonicalFullHistoryCoverageDTO } from '@history-scan-coordinator/use-cases/get-full-history-canonical-coverage/FullHistoryCanonicalCoverageDTO.js';

export interface FullHistoryStatusDTO {
	readonly canonicalCoverage: CanonicalFullHistoryCoverageDTO | null;
	readonly canonicalPromotion: CanonicalFullHistoryPromotionDTO | null;
	readonly earliestParsedLedger: string | null;
	readonly generatedAt: string;
	readonly latestObservedAt: string | null;
	readonly latestParsedLedger: string | null;
	readonly ledgerCloseMeta: FullHistoryLedgerCloseMetaCoverageDTO | null;
	readonly ledgerCloseMetaState: FullHistoryLedgerCloseMetaStateStatusDTO;
	readonly localAssetIndexReady: boolean;
	readonly localContractIndexReady: boolean;
	readonly localOperationIndexReady: boolean;
	readonly localTransactionIndexReady: boolean;
	readonly mode: 'archive_header_parser' | 'canonical_checkpoint_index';
	readonly historicalBackfill: HistoricalFullHistoryBackfillDTO | null;
	readonly parsedLedgerCount: number | null;
	readonly sourceArchiveCount: number | null;
	readonly status: StatusLevel;
}

export interface CanonicalFullHistoryPromotionDTO {
	readonly checkpointLedger: string | null;
	readonly heartbeatAt: string;
	readonly lastAttemptAt: string | null;
	readonly lastErrorCode: string | null;
	readonly lastFailureAt: string | null;
	readonly lastOutcome:
		'bootstrap-required' | 'proof-pending' | 'promoted' | 'replayed' | null;
	readonly lastSuccessAt: string | null;
	readonly nextLedger: string | null;
	readonly startedAt: string;
	readonly state:
		| 'failed'
		| 'promoting'
		| 'running'
		| 'stale'
		| 'stopped'
		| 'waiting-for-proof';
}

export interface IngestionStatusDTO extends FullHistoryStatusDTO {
	readonly queue: {
		readonly doneJobs: number;
		readonly pendingJobs: number;
		readonly takenJobs: number;
		readonly latestJobUpdateAt: string | null;
	};
}

export interface IndexingJobDTO {
	readonly concurrency: number | null;
	readonly fromLedger: string | null;
	readonly latestScannedLedger: string;
	readonly remoteId: string;
	readonly status: 'DONE' | 'PENDING' | 'TAKEN';
	readonly toLedger: string | null;
	readonly updatedAt: string | null;
	readonly url: string;
}

export interface IndexingJobsDTO {
	readonly generatedAt: string;
	readonly jobs: readonly IndexingJobDTO[];
	readonly limit: number;
	readonly summary: IngestionStatusDTO['queue'];
}

export interface IndexingRangeDTO {
	readonly archiveUrl: string;
	readonly earliestParsedLedger: string;
	readonly latestObservedAt: string;
	readonly latestParsedLedger: string;
	readonly parsedLedgerCount: number;
}

export interface IndexingRangesDTO {
	readonly generatedAt: string;
	readonly limit: number;
	readonly ranges: readonly IndexingRangeDTO[];
}

export interface LedgerIngestionStatusDTO {
	readonly generatedAt: string;
	readonly header: {
		readonly bucketListHash: string;
		readonly ledgerHeaderHash: string;
		readonly protocolVersion: number;
		readonly sourceArchiveUrl: string;
		readonly transactionResultHash: string;
		readonly transactionSetHash: string;
	} | null;
	readonly ledger: string;
	readonly parsedHeaderAvailable: boolean;
	readonly status: 'parsed' | 'unparsed';
}
