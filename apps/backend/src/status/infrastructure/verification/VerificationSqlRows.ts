/** TypeORM/Postgres UPDATE and DELETE use [records, affectedCount]; SELECT/INSERT use records. */
export function verificationReturnedRows(
	result: unknown
): readonly Record<string, unknown>[] {
	if (!Array.isArray(result))
		throw new Error('Unsupported verification database result');
	let rows: unknown[] = result;
	if (
		result.length === 2 &&
		Array.isArray(result[0]) &&
		typeof result[1] === 'number'
	) {
		rows = result[0];
		if (result[1] !== rows.length)
			throw new Error('Inconsistent verification database result');
	}
	if (
		!rows.every(
			(row): row is Record<string, unknown> =>
				!!row && typeof row === 'object' && !Array.isArray(row)
		)
	)
		throw new Error('Invalid verification database row');
	return rows;
}
