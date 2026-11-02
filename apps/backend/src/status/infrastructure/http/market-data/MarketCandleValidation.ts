import { StrKey } from '@stellar/stellar-sdk';
import { HubbleWarehouseInputError } from '../HubbleWarehouseErrors.js';
import {
	marketCandleResolutions,
	marketMaximumLedgerSpan,
	type MarketCandleInput
} from './MarketCandleContracts.js';

const allowed = new Set([
	'from',
	'to',
	'resolution',
	'limit',
	'min_ledger',
	'max_ledger'
]);
export function parseMarketCandleInput(
	base: string,
	quote: string,
	query: Readonly<Record<string, unknown>>
): MarketCandleInput {
	for (const name of Object.keys(query))
		if (!allowed.has(name)) fail('Unsupported candle parameter: ' + name);
	const normalizedBase = marketAsset(base),
		normalizedQuote = marketAsset(quote);
	if (normalizedBase === normalizedQuote)
		fail('base and quote must be different assets');
	const resolution = integer(query.resolution, 'resolution', 1, 86400) ?? 300;
	if (!(marketCandleResolutions as readonly number[]).includes(resolution))
		fail('resolution must be 60, 300, 900, 3600, 14400, or 86400 seconds');
	const limit = integer(query.limit, 'limit', 1, 200) ?? 200;
	const from = integer(query.from, 'from', 0, 4_294_967_295);
	const to = integer(query.to, 'to', 1, 4_294_967_295);
	if ((from === undefined) !== (to === undefined))
		fail('Supply both from and to as Unix seconds');
	if (from !== undefined && to !== undefined)
		validateCandleTimeRange(from, to, resolution, limit);
	const minLedger = integer(query.min_ledger, 'min_ledger', 2, 4_294_967_295);
	const maxLedger = integer(query.max_ledger, 'max_ledger', 2, 4_294_967_295);
	if ((minLedger === undefined) !== (maxLedger === undefined))
		fail('Supply both min_ledger and max_ledger');
	if (
		minLedger !== undefined &&
		maxLedger !== undefined &&
		(minLedger > maxLedger ||
			maxLedger - minLedger + 1 > marketMaximumLedgerSpan)
	)
		fail('Ledger window must be ordered and contain at most 65536 ledgers');
	return {
		base: normalizedBase,
		quote: normalizedQuote,
		resolution,
		limit,
		from,
		to,
		minLedger,
		maxLedger
	};
}

export function validateCandleTimeRange(
	from: number,
	to: number,
	resolution: number,
	limit: number
): void {
	if (from >= to) fail('from must be before the exclusive to timestamp');
	const buckets =
		Math.floor((to - 1) / resolution) - Math.floor(from / resolution) + 1;
	if (buckets > limit)
		fail(
			'Time window exceeds limit time bins; shorten the range or increase resolution'
		);
}

export function marketAsset(value: string): string {
	if (value.toLowerCase() === 'native') return 'native';
	const match = /^([A-Za-z0-9]{1,12}):(G[A-Z2-7]{55})$/.exec(value);
	if (!match || !StrKey.isValidEd25519PublicKey(match[2]!))
		fail('Assets must be native or CODE:ISSUER with a valid G address');
	return value;
}

function integer(
	value: unknown,
	name: string,
	minimum: number,
	maximum: number
): number | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value))
		fail(name + ' must be one integer');
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < minimum || number > maximum)
		fail(name + ' is outside its supported range');
	return number;
}
function fail(message: string): never {
	throw new HubbleWarehouseInputError(message);
}
