import {
	FeeBumpTransaction,
	Networks,
	TransactionBuilder
} from '@stellar/stellar-sdk';
import type { HubbleExactAmount } from './HubbleTransactionContracts.js';

/** The ETL's legacy operation details use floats. Only decode envelope values as exact. */
export function transactionEnvelopeOperations(
	envelope: string,
	hash: string
): readonly unknown[] | null {
	try {
		const parsed = TransactionBuilder.fromXDR(envelope, Networks.PUBLIC);
		if (parsed.hash().toString('hex') !== hash) return null;
		const transaction =
			parsed instanceof FeeBumpTransaction ? parsed.innerTransaction : parsed;
		return transaction.operations;
	} catch {
		return null;
	}
}
const amountFields = new Set([
	'amount',
	'startingBalance',
	'sendMax',
	'destAmount',
	'sendAmount',
	'destMin',
	'limit',
	'buyAmount',
	'maxAmountA',
	'maxAmountB',
	'minAmountA',
	'minAmountB'
]);
export function envelopeAmounts(
	operation: unknown
): readonly HubbleExactAmount[] {
	if (operation === null || typeof operation !== 'object') return [];
	return Object.entries(operation).flatMap(([field, value]) => {
		if (!amountFields.has(field) || typeof value !== 'string') return [];
		const amount = exactDecimalAmount(field, value, 'envelope', 7);
		return amount === null ? [] : [amount];
	});
}
export function exactDecimalAmount(
	field: string,
	value: string,
	source: 'envelope' | 'effect',
	scale: number
): HubbleExactAmount | null {
	const match = /^(-?)([0-9]+)(?:\.([0-9]+))?$/.exec(value);
	if (!match || (match[3]?.length ?? 0) > scale) return null;
	const units = BigInt(match[2]! + (match[3] ?? '').padEnd(scale, '0'));
	const raw = (match[1] === '-' ? -units : units).toString();
	return { field, decimal: value, raw, scale, source };
}
