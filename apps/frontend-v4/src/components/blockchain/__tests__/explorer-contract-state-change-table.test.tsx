import { jest } from '@jest/globals';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

jest.unstable_mockModule(
	'../explorer-contract-state-change-table.module.css',
	() => ({ default: {} })
);
const { ExplorerContractStateChangeTable } =
	await import('../explorer-contract-state-change-table');

const address = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const hash = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

describe('ExplorerContractStateChangeTable', () => {
	it('renders typed vector keys and nested price data as readable exact fields', () => {
		const html = renderToStaticMarkup(
			createElement(ExplorerContractStateChangeTable, {
				rows: [
					{
						id: 'state-1',
						ledger_sequence: '64877689',
						transaction_hash: hash,
						closed_at: '2026-10-10 23:17:07.000000',
						key_decoded: { vec: [{ symbol: 'feed' }, { string: 'EUROC/EUR' }] },
						val_decoded: {
							map: [
								{
									key: { symbol: 'price_data' },
									val: {
										vec: [
											{
												map: [
													{
														key: { symbol: 'timestamp' },
														val: { u64: '1791674220000' }
													},
													{
														key: { symbol: 'price' },
														val: {
															i128: '-170141183460469231731687303715884105727'
														}
													},
													{
														key: { symbol: 'source_account' },
														val: { address }
													}
												]
											}
										]
									}
								}
							]
						}
					}
				]
			})
		);
		expect(html).toContain('Feed</span><span> / EUROC/EUR');
		expect(html).toContain('aria-label="Price data"');
		expect(html).toContain('price_data[0].timestamp');
		expect(html).toContain('Timestamp');
		expect(html).toContain('1791674220000');
		expect(html).toContain('-170141183460469231731687303715884105727');
		expect(html).toContain(`href="/explorer/accounts/${address}"`);
		expect(html).toContain(`href="/explorer/ledgers/64877689"`);
		expect(html).toContain(
			`href="/explorer/transactions/${hash}?ledger_sequence=64877689"`
		);
		expect(html).toContain('View raw');
		expect(html).not.toContain('"price_data"');
	});

	it('keeps unknown bytes explicit and escapes untrusted key text', () => {
		const hostile = '<img src=x onerror=alert(1)>';
		const html = renderToStaticMarkup(
			createElement(ExplorerContractStateChangeTable, {
				rows: [
					{
						id: 'binary',
						ledger_sequence: '4',
						key_decoded: JSON.stringify({ string: hostile }),
						val_decoded: '{"bytes":"ff00"}'
					}
				]
			})
		);
		expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
		expect(html).not.toContain('<img src=x onerror=alert(1)>');
		expect(html).toContain('Binary payload · 2 bytes');
		expect(html).toContain('View raw');
	});

	it('shows empty containers and explicit void values', () => {
		const html = renderToStaticMarkup(
			createElement(ExplorerContractStateChangeTable, {
				rows: [
					{ id: 'empty', key_decoded: '{"symbol":"empty"}', val_decoded: '{}' },
					{ id: 'void', key_decoded: '{"symbol":"void"}', val_decoded: 'void' }
				]
			})
		);
		expect(html).toContain('Empty map');
		expect(html).toContain('No value');
	});
});
