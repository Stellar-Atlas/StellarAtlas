import { FullHistoryCanonicalError } from '../../../domain/full-history/FullHistoryCanonicalError.js';

export interface FullHistoryInsertedCountRow {
	readonly insertedCount: number | string;
}

export function assertFullHistoryInsertedCount(
	rows: readonly FullHistoryInsertedCountRow[],
	expectedCount: number,
	factName: string
): void {
	const rawCount = rows[0]?.insertedCount;
	const insertedCount =
		typeof rawCount === 'number' ? rawCount : Number(rawCount);
	if (
		rows.length !== 1 ||
		!Number.isSafeInteger(insertedCount) ||
		insertedCount !== expectedCount
	) {
		throw new FullHistoryCanonicalError(
			'canonical-row-conflict',
			`Canonical ${factName} insert wrote ${String(rawCount)} of ${expectedCount} expected rows`
		);
	}
}
