export const repairSourceResolutionConcurrency = 4;

export async function mapRepairSourcesWithBoundedConcurrency<Row, Result>(
	rows: readonly Row[],
	mapper: (row: Row) => Promise<Result>
): Promise<Result[]> {
	const results = new Array<Result>(rows.length);
	let cursor = 0;
	await Promise.all(
		Array.from(
			{ length: Math.min(rows.length, repairSourceResolutionConcurrency) },
			async () => {
				while (cursor < rows.length) {
					const index = cursor;
					cursor++;
					const row = rows[index];
					if (row === undefined) return;
					results[index] = await mapper(row);
				}
			}
		)
	);
	return results;
}
