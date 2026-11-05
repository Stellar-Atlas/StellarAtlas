/// <reference types="jest" />
import { renderToStaticMarkup } from 'react-dom/server';
import type { PublicRecentTransactions } from '@api/types';
import { jest } from '@jest/globals';
jest.unstable_mockModule('../explorer-transaction-table.module.css', () => ({
	default: {}
}));
jest.unstable_mockModule('../explorer-entity.module.css', () => ({
	default: {}
}));
const { ExplorerTransactionTable } =
	await import('../explorer-transaction-table');
const { ExplorerTransactionPageResults } =
	await import('../explorer-transaction-page-results');
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
			/>
		);
		expect(html).toContain('<table');
		expect(html).toContain('role="columnheader">Source account');
		expect(html).toContain(
			'/explorer/transactions/' + transaction.hash + '?ledger_sequence=12345678'
		);
		expect(html).toContain('/explorer/accounts/' + transaction.sourceAccount);
		expect(html).toContain('/explorer/ledgers/12345678');
		expect(html).toContain('900,719,925.4740993');
		expect(html.replaceAll('<!-- -->', '')).toContain('9007199254740993 stroops');
		expect(html).toContain('Failed');
		expect(html).toContain('Latest available transaction records');
		expect(html).toContain('data-label="Fee (XLM)"');
		expect(html.match(/href="\/explorer\/transactions\//g)).toHaveLength(1);
		expect(html).not.toContain('Inspect');
		expect(html).toContain('<code>' + transaction.hash + '</code>');
		expect(html).toContain('<code>' + transaction.sourceAccount + '</code>');
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
			/>
		);
		expect(html).toContain(transaction.hash);
		expect(html).not.toContain('b'.repeat(64));
	});
	it('keeps empty data distinct from errors', () => {
		const html = renderToStaticMarkup(
			<ExplorerTransactionTable
				transactions={{ ...feed, records: [] }}
			/>
		);
		expect(html).toContain('No transactions returned');
		expect(html).not.toContain('<table');
	});
	it('summarizes only shown, bounded rows and maps each ledger to an existing transaction link', () => {
		const firstHash = 'b'.repeat(64);
		const rows = [
			{ ...transaction, hash: firstHash },
			{ ...transaction, hash: 'c'.repeat(64) },
			{ ...transaction, hash: 'd'.repeat(64), ledger: '12345677', successful: true },
			{ ...transaction, hash: 'e'.repeat(64), ledger: '12345676', successful: true }
		];
		const markup = (result: 'all' | 'failed') => renderToStaticMarkup(
			<ExplorerTransactionPageResults transactions={{ records: rows, limit: 3 }} result={result} caption="Loaded page" />
		);
		const all = markup('all');
		expect(all).toContain('Jump to ledger on this page');
		expect(all).toContain('12,345,678 · 2 transactions');
		expect(all).toContain('12,345,677 · 1 transaction');
		expect(all).not.toContain('12,345,676');
		expect(all).toMatch(new RegExp('<a id="[^"]+-' + firstHash + '"[^>]+href="/explorer/transactions/' + firstHash));
		expect(all).toContain('900,719,925.4740993');
		const failed = markup('failed');
		expect(failed).not.toContain('Jump to ledger');
		expect(failed).not.toContain('12345677');
		expect(failed).toContain('<table');
	});
	it('preserves exact seven-place scaling and does not turn missing or invalid fees into zero', () => {
		for (const [fee, shown] of [['100', '0.00001'], ['1', '0.0000001'], ['0', '0'], ['', '—'], ['unknown', '—']] as const) {
			const html = renderToStaticMarkup(<ExplorerTransactionTable transactions={{ ...feed, records: [{ ...transaction, feeCharged: fee }] }} />);
			expect(html).toContain(shown);
			if (!/^\d+$/.test(fee)) expect(html).not.toContain(' stroops');
		}
	});

	it('renders a single ledger-aware shareable transaction link with a validated return URL', () => {
		const returnTo = '/explorer/ledgers/12345678?ledger_view=transactions&ledger_tx_offset=25&ledger_tx_for=12345678';
		const markup = (origin: string) => renderToStaticMarkup(<ExplorerTransactionTable transactions={feed} returnTo={origin} />);
		const href = markup(returnTo).match(/href="([^"]*\/transactions\/[^"]*)"/)?.[1]?.replaceAll('&amp;', '&');
		expect(href).toBeDefined();
		const url = new URL(href!, 'https://explorer.invalid');
		expect(url.searchParams.get('ledger_sequence')).toBe(transaction.ledger);
		expect(url.searchParams.get('return_to')).toBe(returnTo);
		expect(markup('//untrusted.invalid')).not.toContain('return_to=');
	});
});
