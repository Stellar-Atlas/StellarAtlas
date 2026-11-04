import { buildLedgerTransactionsPath, parseLedgerTransactions } from '../explorer-ledger-transactions';
import { adjacentLedgerHref, ledgerActivityHref, readLedgerActivity } from '../../components/blockchain/ledger-activity-route';
const row = { transaction_hash: 'a'.repeat(64), ledger_sequence: 100, account: 'G' + 'A'.repeat(55), fee_charged: '9007199254740993', operation_count: 2, successful: false, closed_at: '2026-11-02 00:00:00.000000' };
describe('ledger transaction navigation', () => {
	it('queries one ledger with only narrow presentation columns and bounded pagination', () => {
		const url = new URL(buildLedgerTransactionsPath('100', 25), 'http://fixture.invalid');
		expect(url.pathname).toBe('/v1/datasets/history_transactions/records');
		expect(url.searchParams.get('ledger_sequence')).toBe('100');
		expect(url.searchParams.has('_ledger_sequence')).toBe(false);
		expect(url.searchParams.get('limit')).toBe('25');
		expect(url.searchParams.get('offset')).toBe('25');
		expect(url.searchParams.get('select')).not.toMatch(/tx_meta|tx_envelope|tx_result/);
		expect(parseLedgerTransactions('100', 25, { dataset: 'history_transactions', rows: [row], limit: 25, offset: 25, nextOffset: null }).records[0]?.feeCharged).toBe('9007199254740993');
	});
	it('rejects mismatched ledger, missing fields and unsafe numeric fees rather than showing false rows', () => {
		const page = (record: unknown) => ({ dataset: 'history_transactions', rows: [record], limit: 25, offset: 0 });
		for (const record of [{ ...row, ledger_sequence: 101 }, { ...row, successful: null }, { ...row, fee_charged: Number.MAX_SAFE_INTEGER + 1 }]) expect(() => parseLedgerTransactions('100', 0, page(record))).toThrow('invalid');
		expect(() => buildLedgerTransactionsPath('100', 10001)).toThrow('Invalid');
	});
	it('does not infer continuation from a full page without a server next offset', () => {
		const page = { dataset: 'history_transactions', rows: Array.from({ length: 25 }, (_, index) => ({
			...row, transaction_hash: index.toString(16).padStart(64, '0')
		})), limit: 25, offset: 25 };
		const parsed = parseLedgerTransactions('100', 25, page);
		expect(parsed.records).toHaveLength(25);
		expect(parsed.nextOffset).toBeNull();
		expect(parseLedgerTransactions('100', 25, { ...page, nextOffset: null }).nextOffset).toBeNull();
		expect(parseLedgerTransactions('100', 25, { ...page, nextOffset: 50 }).nextOffset).toBe(50);
	});
	it('shares the transaction panel and exact ledger-bound offset without losing return context', () => {
		const url = new URL(ledgerActivityHref('/explorer/ledgers/100', '?return_to=%2Fexplorer', '100', true, 25, '#activity'), 'http://fixture.invalid');
		expect(readLedgerActivity(url.searchParams, '100')).toEqual({ open: true, offset: 25 });
		expect(readLedgerActivity(url.searchParams, '101')).toEqual({ open: true, offset: 0 });
		expect(url.searchParams.get('return_to')).toBe('/explorer');
		expect(url.hash).toBe('#activity');
		expect(adjacentLedgerHref('1', -1)).toBeNull();
		expect(adjacentLedgerHref('4294967295', 1)).toBeNull();
		expect(adjacentLedgerHref('100', 1)).toBe('/explorer/ledgers/101');
	});
});
