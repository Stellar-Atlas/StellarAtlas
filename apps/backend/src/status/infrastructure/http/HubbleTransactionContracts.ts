import type { HubbleEventClassification } from './HubbleEventClassification.js';

export interface HubbleTransactionInput {
	readonly transactionHash: string;
	readonly ledgerSequence?: number;
	readonly limit?: number;
	readonly operationsAfter?: string;
	readonly effectsAfter?: string;
	readonly eventsAfter?: string;
}
export type HubbleTransactionRelation = 'operations' | 'effects' | 'events';
export interface HubbleExactAmount {
	readonly field: string;
	readonly decimal: string;
	readonly raw: string;
	readonly scale: number;
	readonly source: 'envelope' | 'effect';
}
export interface HubbleTransactionRecord {
	readonly id: string;
	readonly hash: string;
	readonly ledgerSequence: number;
	readonly closedAt: string;
	readonly sourceAccount: string;
	readonly sourceAccountMuxed: string | null;
	readonly sequence: string;
	readonly successful: boolean;
	readonly operationCount: number;
	readonly memoType: string;
	readonly memo: string;
	readonly feeChargedRaw: string;
	readonly maxFeeRaw: string;
	readonly feeAccount: string | null;
	readonly resultCode: string;
}
export interface HubbleTransactionOperation {
	readonly id: string;
	readonly transactionId: string;
	readonly index: number;
	readonly ledgerSequence: number;
	readonly closedAt: string;
	readonly type: string;
	readonly typeCode: number;
	readonly sourceAccount: string;
	readonly sourceAccountMuxed: string | null;
	readonly resultCode: string;
	readonly traceCode: string;
	readonly envelopeDecoded: boolean;
	readonly amounts: readonly HubbleExactAmount[];
	/** Supplemental ETL details may contain rounded numeric amounts. */
	readonly detailsJson: string;
}
export interface HubbleTransactionEffect {
	readonly id: string;
	readonly operationId: string;
	readonly index: number;
	readonly ledgerSequence: number;
	readonly closedAt: string;
	readonly type: string;
	readonly typeCode: number;
	readonly account: string;
	readonly accountMuxed: string | null;
	readonly amounts: readonly HubbleExactAmount[];
	readonly detailsJson: string;
}
export interface HubbleTransactionEvent {
	readonly id: string;
	readonly transactionId: string;
	readonly transactionHash: string;
	readonly operationId: string | null;
	readonly ledgerSequence: number;
	readonly closedAt: string;
	readonly contractId: string;
	readonly type: string;
	readonly typeCode: number;
	readonly successful: boolean;
	readonly inSuccessfulContractCall: boolean;
	readonly topicsJson: string;
	readonly dataJson: string;
	readonly eventXdr: string;
	readonly classification: HubbleEventClassification;
}
export interface HubbleTransactionPage<T> {
	readonly items: readonly T[];
	readonly limit: number;
	readonly nextCursor: string | null;
}
export interface HubbleTransactionDetail {
	readonly transaction: HubbleTransactionRecord;
	readonly operations: HubbleTransactionPage<HubbleTransactionOperation>;
	readonly effects: HubbleTransactionPage<HubbleTransactionEffect>;
	readonly events: HubbleTransactionPage<HubbleTransactionEvent>;
	readonly observedAt: string;
	readonly coverage: 'ingested-only';
}
