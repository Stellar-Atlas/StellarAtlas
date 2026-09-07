import {
	recordValue,
	requestExplorerJson,
	type EntityRecord
} from './explorer-analytics';

export const transactionRelations = [
	'operations',
	'effects',
	'events'
] as const;
export type TransactionRelation = (typeof transactionRelations)[number];
export type TransactionCursors = Partial<Record<TransactionRelation, string>>;

export async function requestExplorerTransaction(
	hash: string,
	ledger: string,
	cursors: TransactionCursors,
	signal: AbortSignal
): Promise<EntityRecord> {
	const query = new URLSearchParams({ view: 'typed', limit: '20' });
	if (ledger.trim()) query.set('ledger_sequence', ledger.trim());
	for (const relation of transactionRelations) {
		const cursor = cursors[relation];
		if (cursor) query.set(relation + '_after', cursor);
	}
	return recordValue(
		await requestExplorerJson(
			'/v1/analytics/transactions/' + encodeURIComponent(hash) + '?' + query,
			signal
		)
	);
}
