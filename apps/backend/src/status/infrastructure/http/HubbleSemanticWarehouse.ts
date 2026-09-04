export interface HubblePreparedParameter {
	readonly name: string;
	readonly type: string;
	readonly value: string;
}

export interface HubblePreparedResponse<T> {
	readonly data?: readonly T[];
}

export interface HubbleSemanticQueryExecutor {
	readonly database: string;
	readonly maximumRows: number;
	execute<T>(
		sql: string,
		parameters: readonly HubblePreparedParameter[]
	): Promise<HubblePreparedResponse<T>>;
}

export interface HubbleAccountTransactionQuery {
	readonly account: string;
	readonly limit?: number;
	readonly offset?: number;
}

export interface HubbleSemanticPage {
	readonly elapsedMilliseconds: number;
	readonly limit: number;
	readonly nextOffset: number | null;
	readonly offset: number;
	readonly rows: readonly Record<string, unknown>[];
}

export interface HubbleAssetReference {
	readonly code: string;
	readonly issuer: string;
	readonly type: 'issued';
}

export interface HubbleNativeAssetReference {
	readonly type: 'native';
}

export interface HubbleAssetHolderQuery {
	readonly account?: string;
	readonly after?: string;
	readonly asset: HubbleAssetReference | HubbleNativeAssetReference;
	readonly limit?: number;
}

export interface HubbleAssetHolderPage {
	readonly asset: string;
	readonly elapsedMilliseconds: number;
	readonly holders: readonly Record<string, unknown>[];
	readonly limit: number;
	readonly nextCursor: string | null;
}

export function boundedSemanticLimit(
	value: number | undefined,
	maximumRows: number
): number {
	const limit = value ?? 100;
	if (!Number.isSafeInteger(limit) || limit < 1) {
		throw new Error('Semantic query limit must be a positive integer');
	}
	return Math.min(limit, Math.min(maximumRows, 200));
}

export function boundedSemanticOffset(value: number | undefined): number {
	const offset = value ?? 0;
	if (!Number.isSafeInteger(offset) || offset < 0) {
		throw new Error('Semantic query offset must be a non-negative integer');
	}
	return offset;
}

export function quoteHubbleIdentifier(value: string): string {
	if (!/^[a-z][a-z0-9_]*$/.test(value)) {
		throw new Error('Invalid Hubble identifier');
	}
	return '`' + value + '`';
}
