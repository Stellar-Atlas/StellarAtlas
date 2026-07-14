import type {
	FullHistoryDecodedLedgerCloseMetaBatch,
	FullHistoryLedgerCloseMetaDecodeRequest,
	FullHistoryLedgerCloseMetaRange
} from './FullHistoryLedgerCloseMetaBatch.js';
import type {
	FullHistoryLedgerCloseMetaSourceDescriptor,
	FullHistoryLedgerCloseMetaSourceObject,
	FullHistoryLedgerCloseMetaSourceReadResult,
	Sep54LedgerCloseMetaConfig
} from './FullHistoryLedgerCloseMetaSource.js';

export interface FullHistoryLedgerCloseMetaBatchDecoderPort {
	decode(
		request: FullHistoryLedgerCloseMetaDecodeRequest
	):
		| FullHistoryDecodedLedgerCloseMetaBatch
		| Promise<FullHistoryDecodedLedgerCloseMetaBatch>;
}

export interface FullHistoryLedgerCloseMetaSourcePort {
	readBatch(
		objectKey: string,
		signal: AbortSignal
	): Promise<FullHistoryLedgerCloseMetaSourceReadResult>;

	readConfig(
		signal: AbortSignal
	): Promise<FullHistoryLedgerCloseMetaSourceObject>;

	source(): FullHistoryLedgerCloseMetaSourceDescriptor;
}

export interface FullHistoryLedgerCloseMetaFrontierPort {
	readLatestRange(
		config: Sep54LedgerCloseMetaConfig,
		signal: AbortSignal
	): Promise<FullHistoryLedgerCloseMetaRange>;
}
