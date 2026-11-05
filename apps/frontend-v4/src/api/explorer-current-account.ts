import { recordValue } from './explorer-analytics';
import { isClassicAccount } from '../domain/classic-account';

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

/** Horizon supplies decimal strings. Convert to stroops without using Number. */
function amount(value: unknown): bigint | null {
	if (value === undefined || value === null) return null;
	if (typeof value !== 'string' || !/^\d{1,13}(?:\.\d{1,7})?$/.test(value)) invalid();
	const [whole, fraction = ''] = value.split('.');
	const raw = BigInt(whole! + fraction.padEnd(7, '0'));
	return raw <= maxAmount ? raw : invalid();
}

export function parseCurrentAccount(account: string, payload: unknown): CurrentAccount {
	const data = recordValue(payload);
	if (!isClassicAccount(account) || data.account_id !== account ||
		!Array.isArray(data.balances) || data.balances.length > maximumRows) invalid();
	const ids = new Set<string>();
	const balances = data.balances.map((item): CurrentBalance => {
		const row = recordValue(item);
		const balance = amount(row.balance);
		if (balance === null) invalid();
		const shared = {
			balance, buying: amount(row.buying_liabilities), selling: amount(row.selling_liabilities),
			limit: amount(row.limit),
			authorization: row.is_authorized === true ? 'authorized'
				: row.is_authorized_to_maintain_liabilities === true ? 'liabilities-only'
				: row.is_authorized === false ? 'restricted' : 'unknown',
			sponsor: typeof row.sponsor === 'string' && isClassicAccount(row.sponsor) ? row.sponsor : null
		} as const;
		let result: CurrentBalance;
		if (row.asset_type === 'native') result = { kind: 'native', id: 'native', ...shared };
		else if (row.asset_type === 'liquidity_pool_shares' &&
			typeof row.liquidity_pool_id === 'string' && /^[a-f0-9]{64}$/.test(row.liquidity_pool_id))
			result = { kind: 'pool', id: row.liquidity_pool_id, ...shared };
		else if (row.asset_type === 'credit_alphanum4' || row.asset_type === 'credit_alphanum12') {
			const identity = typeof row.asset_code === 'string' && typeof row.asset_issuer === 'string'
				? classicAssetIdentity(row.asset_code + ':' + row.asset_issuer) : null;
			if (!identity) invalid();
			result = { kind: 'credit', ...identity, ...shared };
		} else invalid();
		if (ids.has(result.id)) invalid();
		ids.add(result.id);
		return result;
	});
	if (!ids.has('native')) invalid();
	const ledger = data.last_modified_ledger;
	return { balances, lastModifiedLedger: typeof ledger === 'number' && Number.isInteger(ledger) &&
		ledger > 0 && ledger <= 4294967295 ? ledger : null };
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
		if (problem.status !== 404 || problem.type !== 'https://stellar.org/horizon-errors/not_found') invalid();
		return null;
	}
	if (response.status !== 200) invalid();
	return parseCurrentAccount(account, payload);
}
