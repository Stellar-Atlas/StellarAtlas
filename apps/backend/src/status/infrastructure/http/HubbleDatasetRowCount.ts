export function hubbleDatasetRowCount(
	name: string,
	rowsByTable: ReadonlyMap<string, string>
): string {
	return (
		rowsByTable.get(name) ??
		(name === 'ledger_transactions'
			? rowsByTable.get('history_transactions') ?? '0'
			: '0')
	);
}
