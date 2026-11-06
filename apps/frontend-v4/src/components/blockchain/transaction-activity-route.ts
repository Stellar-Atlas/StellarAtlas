import { transactionRelations, type TransactionCursors, type TransactionRelation } from '../../api/explorer-transaction';

export interface TransactionActivityRoute {
	readonly ledger: string;
	readonly cursors: TransactionCursors;
}
type Query = Pick<URLSearchParams, 'get' | 'getAll'>;
const cursorKeys = transactionRelations.map((relation) => relation + '_after');

export function readTransactionActivityRoute(params: Query, hash: string): TransactionActivityRoute {
	const value = params.get('ledger_sequence') ?? '';
	const ledger = params.getAll('ledger_sequence').length <= 1 && validLedger(value) ? value : '';
	const cursors: TransactionCursors = {};
	if (params.get('activity_for') !== hash || params.getAll('activity_for').length !== 1 ||
		cursorKeys.some((key) => params.getAll(key).length > 1)) return { ledger, cursors };
	for (const relation of transactionRelations) {
		const cursor = params.get(relation + '_after');
		if (validActivityCursor(cursor)) cursors[relation] = cursor;
	}
	return { ledger, cursors };
}

export function transactionActivityHref(path: string, search: string, route: TransactionActivityRoute, hash: string, fragment = ''): string {
	const params = new URLSearchParams(search);
	params.delete('ledger_sequence');
	params.delete('activity_for');
	for (const key of cursorKeys) params.delete(key);
	if (route.ledger && validLedger(route.ledger)) params.set('ledger_sequence', route.ledger);
	for (const relation of transactionRelations) {
		const cursor = route.cursors[relation];
		if (validActivityCursor(cursor)) {
			params.set(relation + '_after', cursor);
			params.set('activity_for', hash);
		}
	}
	return path + (params.size ? '?' + params.toString() : '') + fragment;
}

export function validLedger(value: string): boolean {
	return value === '' || (/^[1-9]\d{0,9}$/.test(value) && Number(value) <= 4294967295);
}

export function resolveTypedTransactionLedger(
	hash: string,
	requestedLedger: string,
	transaction: Readonly<Record<string, unknown>>
): string {
	if (typeof transaction.hash !== 'string' || !/^[a-f0-9]{64}$/i.test(transaction.hash) ||
		transaction.hash.toLowerCase() !== hash.toLowerCase())
		throw new Error('The data service returned a different transaction.');
	const sequence = transaction.ledgerSequence;
	// Match the typed transaction proxy's signed Int32 ledger bound.
	if (typeof sequence !== 'number' || !Number.isInteger(sequence) || sequence < 1 || sequence > 2_147_483_647)
		throw new Error('The data service returned an invalid transaction ledger.');
	const resolved = String(sequence);
	if (requestedLedger && requestedLedger !== resolved)
		throw new Error('The data service returned a different ledger for this transaction.');
	return resolved;
}

export function validActivityCursor(value: string | null | undefined): value is string {
	return !!value && value.length <= 2048 && !/[\u0000-\u001f\u007f]/.test(value);
}

export function transactionActivityKey(route: TransactionActivityRoute): string {
	return JSON.stringify([route.ledger, ...transactionRelations.map((relation) => route.cursors[relation] ?? '')]);
}

export function transactionRelationPositionKey(route: TransactionActivityRoute, relation: TransactionRelation): string {
	return JSON.stringify([route.ledger, relation, route.cursors[relation] ?? '']);
}

export function restoreTransactionRelation(
	route: TransactionActivityRoute,
	relation: TransactionRelation,
	previous: string | null | undefined
): TransactionActivityRoute {
	const cursors = { ...route.cursors };
	if (previous == null) delete cursors[relation];
	else cursors[relation] = previous;
	return { ...route, cursors };
}
