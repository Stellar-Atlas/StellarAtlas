import { recordValue } from './explorer-analytics';
import { isClassicAccount } from '../domain/classic-account';
import { currentLedgerSequence, parseCurrentAccountSnapshot, type CurrentAccountSnapshot } from './explorer-current-account-snapshot';

const responseLimit = 2 * 1024 * 1024;
const maximumRows = 2_048;
const maxAmount = 9_223_372_036_854_775_807n;

export type ClassicAssetIdentity = { readonly id: string; readonly code: string; readonly issuer: string };
export type CurrentBalance = (
	| { readonly kind: 'native'; readonly id: 'native' }
	| ({ readonly kind: 'credit' } & ClassicAssetIdentity)
	| { readonly kind: 'pool'; readonly id: string }
) & {
	readonly balance: bigint;
	readonly buying: bigint | null;
	readonly selling: bigint | null;
	readonly limit: bigint | null;
	readonly authorization: 'authorized' | 'liabilities-only' | 'restricted' | 'unknown';
	readonly sponsor: string | null;
};

export interface CurrentAccount {
	readonly balances: readonly CurrentBalance[];
	readonly lastModifiedLedger: number | null;
	readonly snapshot: CurrentAccountSnapshot;
}

export function classicAssetIdentity(id: string): ClassicAssetIdentity | null {
	const parts = /^([A-Za-z0-9]{1,12}):(G[A-Z2-7]{55})$/.exec(id);
	return parts?.[1] && parts[2] && isClassicAccount(parts[2])
		? { id, code: parts[1], issuer: parts[2] }
		: null;
}

function invalid(): never {
	throw new Error('Invalid current account response');
}

function rawAmount(value: unknown): bigint | null {
	if (typeof value !== 'string' || !/^(0|[1-9]\d{0,18})$/.test(value)) return null;
	const parsed = BigInt(value);
	return parsed <= maxAmount ? parsed : null;
}

function typedBalance(value: unknown): CurrentBalance | null {
	const row = recordValue(value), exact = recordValue(row.exact);
	const balance = rawAmount(exact.balanceRaw);
	if (balance === null) return null;
	const shared = {
		balance, buying: rawAmount(exact.buyingLiabilitiesRaw), selling: rawAmount(exact.sellingLiabilitiesRaw),
		limit: rawAmount(exact.trustLineLimitRaw),
		authorization: exact.isAuthorized === true ? 'authorized'
			: exact.isAuthorizedToMaintainLiabilities === true ? 'liabilities-only'
			: exact.isAuthorized === false ? 'restricted' : 'unknown',
		sponsor: typeof exact.sponsor === 'string' && isClassicAccount(exact.sponsor) ? exact.sponsor : null
	} as const;
	if (row.assetType === 'native' && exact.assetId === 'native')
		return { kind: 'native', id: 'native', ...shared };
	if (row.assetType === 'liquidity_pool_shares' && typeof exact.liquidityPoolId === 'string' &&
		/^[a-f0-9]{64}$/.test(exact.liquidityPoolId) && exact.assetId === 'liquidity_pool_shares:' + exact.liquidityPoolId)
		return { kind: 'pool', id: exact.liquidityPoolId, ...shared };
	if ((row.assetType === 'credit_alphanum4' || row.assetType === 'credit_alphanum12') && typeof exact.assetId === 'string') {
		const asset = classicAssetIdentity(exact.assetId);
		if (asset && row.assetCode === asset.code && row.assetIssuer === asset.issuer)
			return { kind: 'credit', ...asset, ...shared };
	}
	return null;
}

export function parseCurrentAccount(account: string, payload: unknown): CurrentAccount {
	const data = recordValue(payload);
	if (!isClassicAccount(account) || data.accountId !== account || data.source !== 'horizon' ||
		!Array.isArray(data.balances) || data.balances.length > maximumRows) invalid();
	const modified = currentLedgerSequence(data.lastModifiedLedger);
	if (data.lastModifiedLedger !== null && modified === null) invalid();
	const snapshot = parseCurrentAccountSnapshot(data.accounting, modified);
	const balances: CurrentBalance[] = [];
	const ids = new Set<string>();
	for (const candidate of data.balances) {
		const row = typedBalance(candidate);
		if (!row) continue;
		if (ids.has(row.id)) invalid();
		ids.add(row.id);
		balances.push(row);
	}
	if (snapshot.inventoryComplete && (!ids.has('native') || balances.length !== data.balances.length)) invalid();
	return { balances, lastModifiedLedger: modified === null ? null : Number(modified), snapshot };
}

export async function fetchCurrentAccount(account: string, signal: AbortSignal): Promise<CurrentAccount | null> {
	if (!isClassicAccount(account)) invalid();
	const response = await fetch('/api/explorer/current-account/' + encodeURIComponent(account), {
		headers: { accept: 'application/json' }, cache: 'no-store', credentials: 'omit', redirect: 'error', signal
	});
	// A failed proxy or malformed response is never an empty wallet.
	if (!response.headers.get('content-type')?.toLowerCase().includes('json') ||
		Number(response.headers.get('content-length')) > responseLimit || !response.body) {
		void response.body?.cancel().catch(() => undefined);
		invalid();
	}
	if (!response.ok && response.status !== 404) {
		void response.body.cancel().catch(() => undefined);
		invalid();
	}
	const reader = response.body.getReader();
	const decoder = new TextDecoder('utf-8', { fatal: true });
	let bytes = 0;
	let text = '';
	try {
		for (;;) {
			const chunk = await reader.read();
			if (chunk.done) break;
			bytes += chunk.value.byteLength;
			if (bytes > responseLimit) invalid();
			text += decoder.decode(chunk.value, { stream: true });
		}
		text += decoder.decode();
	} finally {
		void reader.cancel().catch(() => undefined);
	}
	const payload: unknown = JSON.parse(text);
	if (response.status === 404) {
		const problem = recordValue(payload);
		if (problem.error !== 'Account not found') invalid();
		return null;
	}
	if (response.status !== 200) invalid();
	return parseCurrentAccount(account, payload);
}
