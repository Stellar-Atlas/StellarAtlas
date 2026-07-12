export function buildFullHistorySqlValues(
	rows: readonly (readonly unknown[])[]
): {
	readonly parameters: unknown[];
	readonly placeholders: string;
} {
	const parameters: unknown[] = [];
	const placeholders = rows.map(
		(row) => `(${row.map((value) => `$${parameters.push(value)}`).join(', ')})`
	);
	return { parameters, placeholders: placeholders.join(',\n') };
}

export function chunkFullHistoryValues<Value>(
	values: readonly Value[],
	size: number
): Value[][] {
	const output: Value[][] = [];
	for (let offset = 0; offset < values.length; offset += size) {
		output.push(values.slice(offset, offset + size));
	}
	return output;
}
