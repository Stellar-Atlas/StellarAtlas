/// <reference types="jest" />
import { renderToStaticMarkup } from 'react-dom/server';
import type { PublicRecentTransactions } from '@api/types';
import { jest } from '@jest/globals';
jest.unstable_mockModule('../explorer-transaction-table.module.css', () => ({
	default: {}
}));
const { ExplorerTransactionTable } =
	await import('../explorer-transaction-table');
const transaction = {
	hash: 'a'.repeat(64),
	ledger: '12345678',
	sourceAccount: 'G' + 'A'.repeat(55),
	feeCharged: '9007199254740993',
	operationCount: 3,
	successful: false,
	createdAt: '2026-09-01T00:00:00.000Z'
};
const feed: PublicRecentTransactions = {
	dataThrough: transaction.createdAt,
	freshness: 'stale',
	freshnessThresholdMs: 300000,
	generatedAt: transaction.createdAt,
	limit: 20,
	records: [transaction],
	selectionReason: 'local_history_behind',
	source: 'live_network',
	truncated: false
};
describe('ExplorerTransactionTable', () => {
	it('renders semantic headers, linked entities, exact raw fees and an honest dated caption', () => {
		const html = renderToStaticMarkup(
			<ExplorerTransactionTable
				transactions={feed}
				onInspect={() => undefined}
			/>
		);
		expect(html).toContain('<table');
		expect(html).toContain('scope="col">Source account');
		expect(html).toContain(
			'/explorer/transactions/' + transaction.hash + '?ledger_sequence=12345678'
		);
		expect(html).toContain('/explorer/accounts/' + transaction.sourceAccount);
		expect(html).toContain('/explorer/ledgers/12345678');
		expect(html).toContain('9007199254740993');
		expect(html).toContain('Failed');
		expect(html).toContain('Latest available transaction records');
		expect(html).toContain('data-label="Fee (stroops)"');
		expect(html).toContain('dateTime="' + transaction.createdAt + '"');
	});
	it('caps rows at the returned limit without claiming a full chain inventory', () => {
		const html = renderToStaticMarkup(
			<ExplorerTransactionTable
				transactions={{
					...feed,
					limit: 1,
					records: [transaction, { ...transaction, hash: 'b'.repeat(64) }]
				}}
				onInspect={() => undefined}
			/>
		);
		expect(html).toContain(transaction.hash);
		expect(html).not.toContain('b'.repeat(64));
	});
	it('keeps empty data distinct from errors', () => {
		const html = renderToStaticMarkup(
			<ExplorerTransactionTable
				transactions={{ ...feed, records: [] }}
				onInspect={() => undefined}
			/>
		);
		expect(html).toContain('No transactions returned');
		expect(html).not.toContain('<table');
	});
});
