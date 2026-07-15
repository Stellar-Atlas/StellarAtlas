export const FULL_HISTORY_STATE_EXPORT_VERSION =
	'stellar-atlas.full-history-state-export.v1' as const;

export const FULL_HISTORY_STATE_DATASETS = [
	'account-state-changes',
	'trustline-state-changes'
] as const;

export type FullHistoryStateDataset =
	(typeof FULL_HISTORY_STATE_DATASETS)[number];

export interface FullHistoryStateChangeProvenance {
	readonly changeIndex: string;
	readonly changeType: number;
	readonly changeTypeString: string;
	readonly closedAtUnixMillis: string;
	readonly deleted: boolean;
	readonly lastModifiedLedger: string;
	readonly ledgerKeySha256: string;
	readonly ledgerSequence: string;
	readonly operationIndex: string | null;
	readonly reason: string;
	readonly sponsor: string | null;
	readonly stateEntryXdrBase64: string;
	readonly transactionHash: string;
	readonly transactionIndex: string;
	readonly upgradeIndex: string | null;
}

export interface FullHistoryAccountStateChange extends FullHistoryStateChangeProvenance {
	readonly accountId: string;
	readonly balance: string;
	readonly buyingLiabilities: string;
	readonly flags: string;
	readonly highThreshold: number;
	readonly homeDomain: string;
	readonly inflationDestination: string | null;
	readonly lowThreshold: number;
	readonly masterWeight: number;
	readonly mediumThreshold: number;
	readonly sequenceLedger: string | null;
	readonly sequenceNumber: string;
	readonly sequenceTime: string | null;
	readonly signerCount: string;
	readonly signerKeys: readonly string[];
	readonly signerSponsors: readonly (string | null)[];
	readonly signerWeights: readonly number[];
	readonly sellingLiabilities: string;
	readonly sponsoredEntryCount: string;
	readonly sponsoringEntryCount: string;
	readonly subentryCount: string;
}

export interface FullHistoryTrustlineStateChange extends FullHistoryStateChangeProvenance {
	readonly accountId: string;
	readonly assetCode: string;
	readonly assetIssuer: string;
	readonly assetType: number;
	readonly assetTypeString: string;
	readonly balance: string;
	readonly buyingLiabilities: string;
	readonly flags: string;
	readonly limit: string;
	readonly liquidityPoolId: string;
	readonly liquidityPoolUseCount: number;
	readonly sellingLiabilities: string;
}

export type FullHistoryStateChange =
	FullHistoryAccountStateChange | FullHistoryTrustlineStateChange;

export interface FullHistoryStateExportHeader {
	readonly dataset: FullHistoryStateDataset;
	readonly sourceSha256: string;
	readonly type: 'header';
	readonly version: typeof FULL_HISTORY_STATE_EXPORT_VERSION;
}

export interface FullHistoryStateExportRow {
	readonly dataset: FullHistoryStateDataset;
	readonly type: 'row';
	readonly value: FullHistoryStateChange;
}

export interface FullHistoryStateExportComplete {
	readonly dataset: FullHistoryStateDataset;
	readonly recordCount: string;
	readonly type: 'complete';
}

export type FullHistoryStateExportEvent =
	| FullHistoryStateExportHeader
	| FullHistoryStateExportRow
	| FullHistoryStateExportComplete;
