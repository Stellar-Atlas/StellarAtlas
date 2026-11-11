export interface HubbleTransferInput {
	readonly account?: string;
	readonly from?: string;
	readonly to?: string;
	readonly asset?: string;
	readonly contractId?: string;
	readonly transactionHash?: string;
	readonly eventTopic?: string;
	readonly startTime?: string;
	readonly endTime?: string;
	readonly minLedger?: number;
	readonly maxLedger?: number;
	readonly amountRaw?: string;
	readonly minAmountRaw?: string;
	readonly maxAmountRaw?: string;
	readonly limit?: number;
	readonly after?: string;
	/** Opt-in bounded verification of classic payments against successful mainnet envelopes. */
	readonly evidence?: 'payment';
}

export interface HubbleTransferAsset {
	readonly id: string;
	readonly type: string;
	readonly code: string | null;
	readonly issuer: string | null;
}

export interface HubbleTransfer {
	readonly id: string;
	readonly ledgerSequence: number;
	readonly closedAt: string;
	readonly transactionHash: string;
	readonly transactionId: string;
	readonly operationId: string | null;
	readonly from: string | null;
	readonly to: string | null;
	readonly toMuxed: string | null;
	readonly asset: HubbleTransferAsset;
	readonly contractId: string;
	readonly eventTopic: string;
	/** Observed signed i128 atomic units; source events are not validity guarantees. */
	readonly amountRaw: string;
	/** Decimal places for classic assets only; unknown contract scales stay null. */
	readonly amountScale: number | null;
	/** Null/absent is unverified, not a failed payment. Never inferred from event text. */
	readonly paymentEvidence?: 'mainnet-successful-payment' | null;
}

export interface HubbleTransferWatermark {
	readonly minimumLedger: number;
	readonly maximumLedger: number;
	readonly observedAt: string;
	readonly coverage: 'ingested-only';
}

export interface HubbleTransferPage {
	readonly transfers: readonly HubbleTransfer[];
	readonly limit: number;
	readonly nextCursor: string | null;
	readonly watermark: HubbleTransferWatermark;
	readonly elapsedMilliseconds: number;
}
