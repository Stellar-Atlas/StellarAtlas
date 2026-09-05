import { HubbleWarehouseInputError } from './HubbleWarehouseErrors.js';
import type { HubbleTransferInput } from './HubbleTransferContracts.js';

export const maximumTransferLedgerSpan = 1_000_000;
export const defaultTransferLedgerSpan = 100_000;
const maximumAmount = (1n << 127n) - 1n;
const addressPattern = /^(?:[GC][A-Z2-7]{55}|M[A-Z2-7]{68})$/;
const integerFields = new Set(['limit', 'minLedger', 'maxLedger']);
const allowedFields = new Set([
	'account',
	'from',
	'to',
	'asset',
	'contractId',
	'transactionHash',
	'eventTopic',
	'startTime',
	'endTime',
	'minLedger',
	'maxLedger',
	'amountRaw',
	'minAmountRaw',
	'maxAmountRaw',
	'limit',
	'after'
]);

export function normalizeHubbleTransferInput(
	input: HubbleTransferInput
): HubbleTransferInput {
	const values: Record<string, string | number> = {};
	for (const [name, value] of Object.entries(input)) {
		if (!allowedFields.has(name)) fail('Unknown transfer filter: ' + name);
		if (value === undefined || value === null) continue;
		if (integerFields.has(name)) {
			if (
				typeof value !== 'number' ||
				!Number.isSafeInteger(value) ||
				value < 1 ||
				value > (name === 'limit' ? 200 : 2_147_483_647)
			)
				fail(name + ' must be a positive bounded integer');
			values[name] = value;
		} else {
			if (typeof value !== 'string' || value === '' || value.length > 2048)
				fail(name + ' must be one non-empty string');
			values[name] = value;
		}
	}
	const result = values as HubbleTransferInput;
	if (
		result.eventTopic !== undefined &&
		!['transfer', 'mint', 'burn', 'clawback', 'fee'].includes(result.eventTopic)
	)
		fail('eventTopic must be transfer, mint, burn, clawback, or fee');
	for (const name of ['account', 'from', 'to'] as const)
		if (result[name] !== undefined && !addressPattern.test(result[name]!))
			fail(name + ' must be a Stellar G, C, or M address');
	if (
		result.contractId !== undefined &&
		!/^C[A-Z2-7]{55}$/.test(result.contractId)
	)
		fail('contractId must be a Stellar C address');
	if (result.asset !== undefined)
		values.asset = normalizeTransferAsset(result.asset);
	if (result.transactionHash !== undefined) {
		if (!/^[a-fA-F0-9]{64}$/.test(result.transactionHash))
			fail('transactionHash must contain 64 hexadecimal characters');
		values.transactionHash = result.transactionHash.toLowerCase();
	}
	for (const name of ['amountRaw', 'minAmountRaw', 'maxAmountRaw'] as const)
		if (result[name] !== undefined)
			values[name] = normalizeRawAmount(result[name]!, name);
	if (
		result.minAmountRaw !== undefined &&
		result.maxAmountRaw !== undefined &&
		BigInt(result.minAmountRaw) > BigInt(result.maxAmountRaw)
	)
		fail('minAmountRaw cannot exceed maxAmountRaw');
	if (
		result.amountRaw !== undefined &&
		((result.minAmountRaw !== undefined &&
			BigInt(result.amountRaw) < BigInt(result.minAmountRaw)) ||
			(result.maxAmountRaw !== undefined &&
				BigInt(result.amountRaw) > BigInt(result.maxAmountRaw)))
	)
		fail('amountRaw is outside the requested amount range');
	for (const name of ['startTime', 'endTime'] as const)
		if (result[name] !== undefined)
			values[name] = normalizeTransferTime(result[name]!, name);
	if (
		result.startTime !== undefined &&
		result.endTime !== undefined &&
		result.startTime >= result.endTime
	)
		fail('startTime must be before endTime');
	if (result.minLedger !== undefined && result.maxLedger !== undefined)
		validateTransferLedgerRange(result.minLedger, result.maxLedger);
	values.limit ??= 100;
	return values as HubbleTransferInput;
}

export function normalizeTransferAsset(value: string): string {
	if (value.toLowerCase() === 'native') return 'native';
	if (!/^[A-Za-z0-9]{1,12}:G[A-Z2-7]{55}$/.test(value))
		fail('asset must be native or CODE:ISSUER with a G-address issuer');
	return value;
}

export function normalizeRawAmount(value: string, name: string): string {
	if (!/^(?:0|[1-9][0-9]{0,38})$/.test(value) || BigInt(value) > maximumAmount)
		fail(
			name + ' must be a canonical non-negative signed-128-bit integer string'
		);
	return value;
}

export function validateTransferLedgerRange(
	minimum: number,
	maximum: number
): void {
	if (minimum > maximum) fail('minLedger cannot exceed maxLedger');
	if (maximum - minimum + 1 > maximumTransferLedgerSpan)
		fail(
			'Transfer queries may span at most 1000000 ledgers; split the requested range'
		);
}

function normalizeTransferTime(value: string, name: string): string {
	if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value))
		fail(name + ' must be a UTC ISO timestamp ending in Z');
	const date = new Date(value);
	if (!Number.isFinite(date.getTime()))
		fail(name + ' must be a valid UTC timestamp');
	const normalized = date.toISOString();
	if (normalized.slice(0, 19) !== value.slice(0, 19))
		fail(name + ' must be a valid calendar timestamp');
	return normalized;
}

function fail(message: string): never {
	throw new HubbleWarehouseInputError(message);
}
