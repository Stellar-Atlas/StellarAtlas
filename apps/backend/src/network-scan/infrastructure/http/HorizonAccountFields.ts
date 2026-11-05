import { StrKey } from '@stellar/stellar-sdk';

export const horizonAccountTimeoutMs = 65_000;
export const maximumInt64 = 0x7fff_ffff_ffff_ffffn;
const maximumUInt32 = 0xffff_ffff;

export function classicAddress(value: unknown): string | null {
	return typeof value === 'string' &&
		value.length === 56 &&
		StrKey.isValidEd25519PublicKey(value)
		? value
		: null;
}

export function amount(
	value: unknown
): { decimal: string; raw: string } | null {
	if (
		typeof value !== 'string' ||
		!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,7})?$/.test(value)
	)
		return null;
	const [whole = '', fraction = ''] = value.split('.');
	const raw = BigInt(whole + fraction.padEnd(7, '0'));
	return raw <= maximumInt64 ? { decimal: value, raw: raw.toString() } : null;
}

export function uint32(value: unknown): number | null {
	return typeof value === 'number' &&
		Number.isInteger(value) &&
		value >= 0 &&
		value <= maximumUInt32
		? value
		: null;
}

export function parseLatestLedger(
	value: string | null,
	modified: number | null = null
): string | null {
	if (!value || !/^[1-9]\d{0,9}$/.test(value)) return null;
	const sequence = uint32(Number(value));
	return sequence !== null && (modified === null || sequence >= modified)
		? value
		: null;
}

export function parseHorizonTimestamp(value: unknown): string | null {
	if (
		typeof value !== 'string' ||
		!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(
			value
		)
	)
		return null;

	// Reject normalized impossible calendar dates independently of the offset.
	const wallTime = value.slice(0, 19);
	const wallTimeAsUtc = new Date(wallTime + 'Z');
	return Number.isFinite(wallTimeAsUtc.valueOf()) &&
		wallTimeAsUtc.toISOString().slice(0, 19) === wallTime
		? value
		: null;
}
