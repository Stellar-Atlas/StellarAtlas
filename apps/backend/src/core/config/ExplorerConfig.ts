import { err, ok, type Result } from 'neverthrow';

export const defaultExplorerTransactionFreshnessWindowMs = 5 * 60 * 1_000;
const minimumExplorerTransactionFreshnessWindowMs = 1_000;
const maximumExplorerTransactionFreshnessWindowMs = 24 * 60 * 60 * 1_000;

export function parseExplorerTransactionFreshnessWindowMs(
	value: string | undefined
): Result<number, Error> {
	if (value === undefined)
		return ok(defaultExplorerTransactionFreshnessWindowMs);
	if (!/^\d+$/.test(value)) return err(invalidFreshnessWindowError());

	const parsed = Number(value);
	if (
		!Number.isSafeInteger(parsed) ||
		parsed < minimumExplorerTransactionFreshnessWindowMs ||
		parsed > maximumExplorerTransactionFreshnessWindowMs
	) {
		return err(invalidFreshnessWindowError());
	}
	return ok(parsed);
}

function invalidFreshnessWindowError(): Error {
	return new Error(
		'EXPLORER_TRANSACTION_FRESHNESS_WINDOW_MS must be an integer between 1000 and 86400000'
	);
}
