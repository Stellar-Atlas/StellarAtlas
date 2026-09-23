import type { HubbleAssetHolderEvidence } from './HubbleSemanticWarehouse.js';

export interface HubbleAccountBalanceInput {
	readonly account: string;
	readonly after?: string;
	readonly limit?: number;
}

export interface HubbleAccountBalance {
	readonly asset: string;
	readonly assetType: 'native' | 'credit_alphanum4' | 'credit_alphanum12';
	readonly assetCode: string | null;
	readonly assetIssuer: string | null;
	readonly balance: number;
	readonly balanceRaw: null;
	readonly amountPrecision: 'float64-observation';
	readonly buyingLiabilities: number;
	readonly sellingLiabilities: number;
	readonly trustLineLimitRaw: string | null;
	readonly flags: number;
	readonly lastModifiedLedger: number;
	readonly observedLedger: number;
}

export interface HubbleAccountBalancePage extends HubbleAssetHolderEvidence {
	readonly account: string;
	readonly balanceScope: 'native-and-issued';
	readonly balances: readonly HubbleAccountBalance[];
	readonly elapsedMilliseconds: number;
	readonly limit: number;
	readonly nextCursor: string | null;
}
