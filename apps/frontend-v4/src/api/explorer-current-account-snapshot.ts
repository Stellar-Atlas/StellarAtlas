import { recordValue } from './explorer-analytics';

// The explorer shell is for the public Stellar network.
export const publicNetworkPassphrase = 'Public Global Stellar Network ; September 2015';
const maximumUInt32 = 0xffff_ffffn;

export interface NativeReserveEvidence {
	readonly latestLedger: string | null;
	readonly baseReserveLedger: string | null;
	readonly baseReserve: bigint | null;
	readonly subentries: bigint | null;
	readonly sponsoring: bigint | null;
	readonly sponsored: bigint | null;
}

export interface CurrentAccountSnapshot extends NativeReserveEvidence {
	readonly closedAt: string | null;
	readonly inventoryComplete: boolean;
}

function uint32(value: unknown): bigint | null {
	if (typeof value !== 'string' || !/^(0|[1-9]\d{0,9})$/.test(value)) return null;
	const parsed = BigInt(value);
	return parsed <= maximumUInt32 ? parsed : null;
}

export function currentLedgerSequence(value: unknown): string | null {
	const parsed = uint32(value);
	return parsed !== null && parsed > 0n ? parsed.toString() : null;
}

function closeTime(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
	if (!match) return null;
	const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
	if (year === undefined || month === undefined || day === undefined || hour === undefined ||
		minute === undefined || second === undefined || month < 1 || month > 12 || day < 1 ||
		day > new Date(Date.UTC(year, month, 0)).getUTCDate() || hour > 23 || minute > 59 || second > 59 ||
		!Number.isFinite(Date.parse(value))) return null;
	return value;
}

export function currentAccountFreshness(closedAt: string | null, now: number): 'recent' | 'stale' | 'unknown' {
	if (closedAt === null) return 'unknown';
	const age = now - Date.parse(closedAt);
	return !Number.isFinite(age) || age < -30_000 ? 'unknown' : age > 300_000 ? 'stale' : 'recent';
}

export function parseCurrentAccountSnapshot(value: unknown, lastModifiedLedger: string | null): CurrentAccountSnapshot {
	const data = recordValue(value);
	if (data.scope !== 'horizon_account_balances' || data.networkPassphrase !== publicNetworkPassphrase ||
		(data.snapshotStatus !== 'ledger_bound' && data.snapshotStatus !== 'ledger_unavailable') ||
		typeof data.balanceInventoryComplete !== 'boolean')
		throw new Error('Invalid current account evidence');
	const latestLedger = currentLedgerSequence(data.latestLedger);
	const bound = data.snapshotStatus === 'ledger_bound';
	if ((bound && latestLedger === null) || (!bound && data.latestLedger !== null) ||
		(latestLedger !== null && lastModifiedLedger !== null && BigInt(latestLedger) < BigInt(lastModifiedLedger)) ||
		(!bound && data.balanceInventoryComplete))
		throw new Error('Invalid current account ledger evidence');
	const reserveLedger = currentLedgerSequence(data.baseReserveLedger);
	const baseReserve = latestLedger !== null && reserveLedger === latestLedger ? uint32(data.baseReserveRaw) : null;
	const closedAt = latestLedger === null ? null : closeTime(data.ledgerClosedAt);
	return {
		latestLedger, closedAt, inventoryComplete: data.balanceInventoryComplete,
		baseReserve, baseReserveLedger: baseReserve === null ? null : reserveLedger,
		subentries: uint32(data.subentryCount), sponsoring: uint32(data.numSponsoring), sponsored: uint32(data.numSponsored)
	};
}
