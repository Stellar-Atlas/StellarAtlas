import { recordValue } from './explorer-analytics';
import { isClassicAccount } from '../domain/classic-account';
import { protocolPositionAssetContract, protocolPositionBytes, protocolPositionCoverage, protocolPositionPool } from '../domain/account-protocol-position';

interface Observation {
	readonly ledger: number;
	readonly closedAt: string;
	readonly freshness: 'recent' | 'historical';
}

export type AccountProtocolPosition =
	| { readonly status: 'unavailable' }
	| { readonly status: 'unobserved'; readonly asOf: Observation }
	| { readonly status: 'observed'; readonly asOf: Observation; readonly sharesRaw: string; readonly estimateRaw: string; readonly rateUpdatedAt: string };

const maxI128 = (1n << 127n) - 1n;
const rateScale = 1_000_000_000_000n;
const invalid = () => new Error('Invalid protocol position evidence');

function amount(value: unknown): string {
	if (typeof value !== 'string' || !/^(0|[1-9]\d{0,38})$/.test(value) || BigInt(value) > maxI128) throw invalid();
	return value;
}

export function parseAccountProtocolPosition(account: string, status: number, payload: unknown): AccountProtocolPosition {
	const row = recordValue(payload), target = recordValue(row.target);
	if (!isClassicAccount(account) || row.accountId !== account || row.network !== 'mainnet' ||
		row.coverage !== protocolPositionCoverage || row.includedInCurrentTotals !== false ||
		target.poolId !== protocolPositionPool || target.assetId !== 'native' || target.assetContractId !== protocolPositionAssetContract ||
		target.reserveIndex !== 0) throw invalid();
	if (status === 503 && row.status === 'unavailable' && row.asOf === null && !('position' in row)) return { status: 'unavailable' };
	if (status !== 200 || (row.status !== 'observed' && row.status !== 'unobserved')) throw invalid();

	const { ledger, ledgerHash, closedAt, ageSeconds, freshness } = recordValue(row.asOf);
	const closeMs = typeof closedAt === 'string' ? Date.parse(closedAt) : NaN;
	if (typeof ledger !== 'number' || !Number.isInteger(ledger) || ledger < 1 || ledger > 0xffff_ffff ||
		typeof ledgerHash !== 'string' || !/^[a-f0-9]{64}$/.test(ledgerHash) ||
		typeof closedAt !== 'string' || !Number.isFinite(closeMs) || closeMs <= 0 || new Date(closeMs).toISOString() !== closedAt ||
		typeof ageSeconds !== 'number' || !Number.isSafeInteger(ageSeconds) || ageSeconds < 0 ||
		(freshness !== 'recent' && freshness !== 'historical')) throw invalid();
	const asOf = { ledger, closedAt, freshness } as const;
	if (row.status === 'unobserved') {
		if ('position' in row) throw invalid();
		return { status: 'unobserved', asOf };
	}
	const position = recordValue(row.position), estimate = recordValue(position.underlyingEstimate);
	if (position.supplyShareDecimals !== 7 || position.balanceScope !== 'separate_protocol_supply' ||
		position.withdrawal !== 'unknown' || estimate.kind !== 'stored_rate' || estimate.decimals !== 7 || estimate.rateDecimals !== 12)
		throw invalid();
	const sharesRaw = amount(position.supplySharesRaw), estimateRaw = amount(estimate.amountRaw);
	const rate = BigInt(amount(estimate.rateRaw)), epoch = estimate.rateUpdatedAtEpochSeconds;
	if (rate <= 0n || (BigInt(sharesRaw) * rate) / rateScale !== BigInt(estimateRaw) ||
		typeof epoch !== 'string' || !/^(0|[1-9]\d{0,19})$/.test(epoch) ||
		BigInt(epoch) > BigInt(Math.floor(closeMs / 1000))) throw invalid();
	return { status: 'observed', asOf, sharesRaw, estimateRaw, rateUpdatedAt: new Date(Number(epoch) * 1000).toISOString() };
}

export async function fetchAccountProtocolPosition(account: string, signal: AbortSignal): Promise<AccountProtocolPosition> {
	if (!isClassicAccount(account)) throw invalid();
	const response = await fetch('/api/explorer/protocol-positions/' + account, {
		headers: { accept: 'application/json' }, credentials: 'omit', cache: 'no-store', redirect: 'error', signal
	});
	if ((response.status !== 200 && response.status !== 503) ||
		response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json' ||
		Number(response.headers.get('content-length')) > protocolPositionBytes || !response.body) {
		void response.body?.cancel().catch(() => undefined);
		throw invalid();
	}
	const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true });
	let bytes = 0, text = '';
	try {
		for (;;) {
			const chunk = await reader.read();
			if (chunk.done) break;
			bytes += chunk.value.byteLength;
			if (bytes > protocolPositionBytes) throw invalid();
			text += decoder.decode(chunk.value, { stream: true });
		}
		return parseAccountProtocolPosition(account, response.status, JSON.parse(text + decoder.decode()));
	} finally {
		void reader.cancel().catch(() => undefined);
	}
}
