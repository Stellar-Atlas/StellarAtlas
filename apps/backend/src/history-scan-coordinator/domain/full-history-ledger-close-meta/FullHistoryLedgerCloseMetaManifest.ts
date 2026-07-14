import type {
	FullHistoryLedgerCloseMetaSequence,
	FullHistoryLedgerCloseMetaSha256Digest
} from './FullHistoryLedgerCloseMetaBatch.js';
import type { FullHistoryLedgerCloseMetaProcessingReceipt } from './FullHistoryLedgerCloseMetaProcessing.js';
import type {
	FullHistoryLedgerCloseMetaSourceDescriptor,
	FullHistoryLedgerCloseMetaSourceObject,
	Sep54LedgerCloseMetaConfig
} from './FullHistoryLedgerCloseMetaSource.js';

export interface FullHistoryLedgerCloseMetaSourceRegistration {
	readonly config: Sep54LedgerCloseMetaConfig;
	readonly configDigest: FullHistoryLedgerCloseMetaSha256Digest;
	readonly configObject: FullHistoryLedgerCloseMetaSourceObject;
	readonly firstAvailableLedger: FullHistoryLedgerCloseMetaSequence;
	readonly networkPassphraseHash: FullHistoryLedgerCloseMetaSha256Digest;
	readonly observedAt: Date;
	readonly source: FullHistoryLedgerCloseMetaSourceDescriptor;
}

export interface FullHistoryLedgerCloseMetaRegisteredSource {
	readonly configDigest: FullHistoryLedgerCloseMetaSha256Digest;
	readonly firstAvailableLedger: FullHistoryLedgerCloseMetaSequence;
	readonly networkPassphraseHash: FullHistoryLedgerCloseMetaSha256Digest;
	readonly nextLedger: number;
	readonly sourceId: string;
	readonly watermarkVersion: number;
}

export interface FullHistoryLedgerCloseMetaProcessedBatchCommit {
	readonly processedAt: Date;
	readonly processing: FullHistoryLedgerCloseMetaProcessingReceipt;
	readonly source: FullHistoryLedgerCloseMetaRegisteredSource;
}

export interface FullHistoryLedgerCloseMetaBatchCommitReceipt {
	readonly batchId: string;
	readonly nextLedger: number;
	readonly replayed: boolean;
	readonly watermarkVersion: number;
}

export interface FullHistoryLedgerCloseMetaManifestRepository {
	commitProcessedBatch(
		batch: FullHistoryLedgerCloseMetaProcessedBatchCommit
	): Promise<FullHistoryLedgerCloseMetaBatchCommitReceipt>;
	readStoredBytes(): Promise<bigint>;
	registerSource(
		registration: FullHistoryLedgerCloseMetaSourceRegistration
	): Promise<FullHistoryLedgerCloseMetaRegisteredSource>;
}
