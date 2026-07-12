import type { ValueTransformer } from 'typeorm';

const maximumLedgerSequence = 0xffff_ffff;
const maximumTransactionIndex = 0x7fff_ffff;

export const parsedLedgerSequenceTransformer: ValueTransformer = {
	from: toParsedLedgerSequence,
	to: toParsedLedgerSequence
};

export function toParsedLedgerSequence(value: number | string): number {
	return toIntegerInRange(value, maximumLedgerSequence, 'ledgerSequence');
}

export function toParsedTransactionIndex(value: number | string): number {
	return toIntegerInRange(value, maximumTransactionIndex, 'transactionIndex');
}

function toIntegerInRange(
	value: number | string,
	maximum: number,
	field: string
): number {
	const parsed = typeof value === 'number' ? value : Number(value);
	if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > maximum) {
		throw new RangeError(`${field} is outside its supported integer range`);
	}
	return parsed;
}
