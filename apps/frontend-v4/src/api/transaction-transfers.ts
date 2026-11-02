import { requestExplorerJson } from './explorer-analytics';
import { parseTransferActivityPage, type TransferActivityPage } from './transfer-activity';

export interface TransactionTransferScope { readonly hash: string; readonly ledger: string }
const validCursor = (value: string): boolean => /^[A-Za-z0-9_-]{1,2048}$/.test(value);
export function validTransactionTransferScope(scope: TransactionTransferScope): boolean {
	return /^[a-f0-9]{64}$/i.test(scope.hash) && /^[1-9][0-9]{0,9}$/.test(scope.ledger) && Number(scope.ledger) <= 2_147_483_647;
}
export function transactionTransferPath(scope: TransactionTransferScope, after: string | null): string {
	if (!validTransactionTransferScope(scope) || (after !== null && !validCursor(after)))
		throw new Error('A resolved transaction and ledger are required.');
	const query = new URLSearchParams({ transaction_hash: scope.hash.toLowerCase(), min_ledger: scope.ledger, max_ledger: scope.ledger, limit: '25' });
	if (after !== null) query.set('after', after);
	return '/v1/activity/transfers?' + query;
}
/** Reject results outside the requested transaction; never silently widen the window. */
export function parseTransactionTransfers(value: unknown, scope: TransactionTransferScope, after: string | null): TransferActivityPage {
	transactionTransferPath(scope, after);
	const page = parseTransferActivityPage(value), watermark = page.watermark, ledger = Number(scope.ledger);
	const invalid = (): never => { throw new Error('The API returned an invalid transaction-transfer page.'); };
	if (page.limit !== 25 || page.transfers.length > 25 ||
		(page.nextCursor !== null && (!validCursor(page.nextCursor) || page.nextCursor === after || !page.transfers.length)) ||
		watermark.coverage !== 'ingested-only' || !Number.isFinite(Date.parse(watermark.observedAt)) ||
		!Number.isSafeInteger(watermark.maximumLedger) || watermark.maximumLedger < 0 || watermark.maximumLedger > ledger ||
		watermark.minimumLedger !== (watermark.maximumLedger === 0 ? 0 : ledger) ||
		!Number.isFinite(page.elapsedMilliseconds) || page.elapsedMilliseconds < 0) invalid();
	const ids = new Set<string>();
	for (const row of page.transfers) {
		if (row.ledgerSequence !== ledger || watermark.maximumLedger !== ledger || row.transactionHash.toLowerCase() !== scope.hash.toLowerCase() ||
			!row.id || row.id.length > 512 || ids.has(row.id) || !Number.isFinite(Date.parse(row.closedAt)) ||
			!/^[0-9]{1,20}$/.test(row.transactionId) || (row.operationId !== null && !/^[0-9]{1,20}$/.test(row.operationId)) ||
			!/^(?:0|-?[1-9][0-9]{0,38})$/.test(row.amountRaw) ||
			BigInt(row.amountRaw) < -(1n << 127n) || BigInt(row.amountRaw) > (1n << 127n) - 1n ||
			row.amountScale !== (['native', 'credit_alphanum4', 'credit_alphanum12'].includes(row.asset.type) ? 7 : null) ||
			![row.asset.id, row.asset.type, row.eventTopic].every(text => text.length > 0 && text.length <= 256) || row.contractId.length > 256 ||
			![row.from, row.to, row.toMuxed, row.asset.code, row.asset.issuer].every(text => text === null || (text.length > 0 && text.length <= 256))) invalid();
		ids.add(row.id);
	}
	return page;
}
export async function requestTransactionTransfers(scope: TransactionTransferScope, after: string | null, signal: AbortSignal): Promise<TransferActivityPage> {
	return parseTransactionTransfers(await requestExplorerJson(transactionTransferPath(scope, after), signal), scope, after);
}

/** Read the actual URL, not only React props: popstate may precede their next render. */
export function transactionTransferLocationMatches(scope: TransactionTransferScope, pathname: string, search: string): boolean {
	if (!validTransactionTransferScope(scope) || pathname.toLowerCase() !== '/explorer/transactions/' + scope.hash.toLowerCase()) return false;
	const values = new URLSearchParams(search).getAll('ledger_sequence');
	return values.length === 0 || (values.length === 1 && (values[0] === '' || values[0] === scope.ledger));
}
