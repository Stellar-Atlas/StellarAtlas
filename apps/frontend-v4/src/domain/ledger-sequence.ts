const ledgerSequencePattern = /^\d+$/;

export const toLedgerSequenceText = (value: unknown): string | null => {
	if (typeof value === 'bigint') return value >= 0n ? value.toString() : null;
	if (typeof value === 'number') {
		return Number.isSafeInteger(value) && value >= 0 ? value.toString() : null;
	}
	if (typeof value !== 'string') return null;

	const trimmed = value.trim();
	if (!ledgerSequencePattern.test(trimmed)) return null;
	return trimmed.replace(/^0+(?=\d)/, '');
};

export const compareLedgerSequences = (
	left: unknown,
	right: unknown
): number => {
	const normalizedLeft = toLedgerSequenceText(left);
	const normalizedRight = toLedgerSequenceText(right);
	if (normalizedLeft === null && normalizedRight === null) return 0;
	if (normalizedLeft === null) return -1;
	if (normalizedRight === null) return 1;

	const difference = BigInt(normalizedLeft) - BigInt(normalizedRight);
	if (difference === 0n) return 0;
	return difference > 0n ? 1 : -1;
};

export const getHighestLedgerSequence = (
	values: readonly unknown[]
): string | null =>
	values.reduce<string | null>((highest, value) => {
		const sequence = toLedgerSequenceText(value);
		if (sequence === null) return highest;
		if (highest === null) return sequence;
		return compareLedgerSequences(sequence, highest) > 0 ? sequence : highest;
	}, null);
