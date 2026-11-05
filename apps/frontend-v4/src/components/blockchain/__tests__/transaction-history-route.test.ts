import { buildLedgerTransactionsPath, parseLedgerTransactions } from '../../../api/explorer-ledger-transactions';
import { withExplorerReturnTo } from '../../../api/explorer-return-context';
import { readTransactionHistory, transactionHistoryHref } from '../transaction-history-route';

const base = 'https://atlas.invalid';
const selection = { ledger: '100', offset: 25 };
it('shares one exact ledger and bounded page without dropping the finder state', () => {
	const origin = transactionHistoryHref('?search=KALE&search_type=asset&tx_ledger=99&tx_offset=50', selection, '#activity');
	const url = new URL(origin, base);
	expect(url.hash).toBe('#activity');
	expect(readTransactionHistory(url.searchParams)).toEqual({ mode: 'ledger', ...selection });
	const transaction = new URL(withExplorerReturnTo('/explorer/transactions/' + 'a'.repeat(64) + '?ledger_sequence=100', origin), base);
	const back = new URL(transaction.searchParams.get('return_to')!, base);
	expect(readTransactionHistory(back.searchParams)).toEqual({ mode: 'ledger', ...selection });
	expect(back.searchParams.get('search')).toBe('KALE');
	const previous = new URL(transactionHistoryHref(back.search, { ledger: '99', offset: 0 }), base);
	expect(previous.searchParams.has('tx_offset')).toBe(false);
	expect(new URL(transactionHistoryHref(previous.search, null), base).search).toBe('?search=KALE&search_type=asset');
});

it('rejects unbounded or ambiguous bookmarked selections instead of widening the read', () => {
	for (const query of ['tx_offset=25', 'tx_ledger=0', 'tx_ledger=4294967296', 'tx_ledger=100&tx_ledger=101',
		'tx_ledger=100&tx_offset=25&tx_offset=50', 'tx_ledger=100&tx_offset=10025', 'tx_ledger=100&tx_offset=3']) {
		expect(readTransactionHistory(new URLSearchParams(query))).toEqual({ mode: 'invalid' });
	}
	expect(readTransactionHistory(new URLSearchParams('search=KALE'))).toEqual({ mode: 'recent' });
	expect(readTransactionHistory(new URLSearchParams('tx_ledger=4294967295&tx_offset=10000'))).toEqual({ mode: 'ledger', ledger: '4294967295', offset: 10000 });
});

it('uses the existing narrow row projection and rejects a non-page continuation', () => {
	const path = new URL(buildLedgerTransactionsPath(selection.ledger, selection.offset), base);
	expect(path.pathname).toBe('/v1/datasets/history_transactions/records');
	expect(path.searchParams.get('ledger_sequence')).toBe('100');
	expect(path.searchParams.get('order')).toBe('id');
	expect(path.searchParams.get('offset')).toBe('25');
	expect(path.searchParams.get('limit')).toBe('25');
	expect(path.searchParams.get('select')).not.toMatch(/envelope|meta/);
	expect(() => parseLedgerTransactions('100', 25, { dataset: 'history_transactions', limit: 25, offset: 25, nextOffset: 26, rows: [] })).toThrow();
});
