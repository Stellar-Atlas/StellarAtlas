import { createHash } from 'node:crypto';
import type {
	HubbleTransferInput,
	HubbleTransferWatermark
} from './HubbleTransferContracts.js';
import { HubbleWarehouseInputError } from './HubbleWarehouseErrors.js';
import { validateTransferLedgerRange } from './HubbleTransferValidation.js';

export interface HubbleTransferPosition {
	readonly ledger: number;
	readonly row: string;
	readonly batch: string;
	readonly digest: string;
}
export interface HubbleTransferCursor {
	readonly version: 1;
	readonly filters: string;
	readonly watermark: HubbleTransferWatermark;
	readonly position: HubbleTransferPosition;
}

export function transferFilterFingerprint(input: HubbleTransferInput): string {
	return createHash('sha256')
		.update(
			JSON.stringify(
				Object.entries(input)
					.filter(([key]) => key !== 'after' && key !== 'limit')
					.sort(([left], [right]) => left.localeCompare(right))
			)
		)
		.digest('hex');
}

export function encodeTransferCursor(cursor: HubbleTransferCursor): string {
	return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

export function decodeTransferCursor(
	value: string,
	fingerprint: string
): HubbleTransferCursor {
	try {
		if (value.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(value))
			throw new Error();
		const parsed: unknown = JSON.parse(
			Buffer.from(value, 'base64url').toString('utf8')
		);
		if (
			!record(parsed) ||
			parsed.version !== 1 ||
			parsed.filters !== fingerprint ||
			!record(parsed.watermark) ||
			!record(parsed.position)
		)
			throw new Error();
		const watermark = parsed.watermark;
		const position = parsed.position;
		if (
			!ledger(watermark.minimumLedger) ||
			!ledger(watermark.maximumLedger) ||
			watermark.coverage !== 'ingested-only' ||
			typeof watermark.observedAt !== 'string' ||
			!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(watermark.observedAt) ||
			!Number.isFinite(Date.parse(watermark.observedAt)) ||
			!ledger(position.ledger) ||
			position.ledger < watermark.minimumLedger ||
			position.ledger > watermark.maximumLedger ||
			typeof position.row !== 'string' ||
			!/^(?:0|[1-9][0-9]{0,19})$/.test(position.row) ||
			BigInt(position.row) > 18446744073709551615n ||
			typeof position.batch !== 'string' ||
			!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(position.batch) ||
			typeof position.digest !== 'string' ||
			!/^[a-f0-9]{64}$/.test(position.digest)
		)
			throw new Error();
		validateTransferLedgerRange(
			watermark.minimumLedger,
			watermark.maximumLedger
		);
		return parsed as unknown as HubbleTransferCursor;
	} catch {
		throw new HubbleWarehouseInputError(
			'Invalid transfer cursor or cursor filters changed'
		);
	}
}
function record(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function ledger(value: unknown): value is number {
	return (
		typeof value === 'number' &&
		Number.isSafeInteger(value) &&
		value > 0 &&
		value <= 2_147_483_647
	);
}
