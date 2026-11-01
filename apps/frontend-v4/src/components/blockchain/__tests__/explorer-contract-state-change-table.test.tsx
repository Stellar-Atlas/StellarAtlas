import { jest } from '@jest/globals';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

jest.unstable_mockModule(
	'../explorer-contract-state-change-table.module.css',
	() => ({ default: {} })
);
jest.unstable_mockModule('../explorer-entity.module.css', () => ({ default: {} }));
jest.unstable_mockModule('../explorer-detail-dialog.module.css', () => ({ default: {} }));
const { ExplorerContractStateChangeTable, ExplorerContractStateDetails } =
	await import('../explorer-contract-state-change-table');

const address = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const hash = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

describe('ExplorerContractStateChangeTable', () => {
	it('opens typed vector keys and nested price data as readable exact fields', () => {
		const html = renderToStaticMarkup(
			createElement(ExplorerContractStateDetails, {
				row:
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
					},
				onClose: () => undefined
			})
		);
		expect(html).toContain('Feed</span><span> / EUROC/EUR');
		expect(html).toContain('aria-label="Price data"');
		expect(html).toContain('price_data[0].timestamp');
		expect(html).toContain('Timestamp');
		expect(html).toContain('1791674220000');
		expect(html).toContain('-170141183460469231731687303715884105727');
		expect(html).toContain('>-170,141,183,460,469,231,731,687,303,715,884,105,727</code>');
		expect(html).toContain('64,877,689</a>');
		expect(html).toContain(`href="/explorer/accounts/${address}"`);
		expect(html).toContain(`href="/explorer/ledgers/64877689"`);
		expect(html).toContain(
			`href="/explorer/transactions/${hash}?ledger_sequence=64877689"`
		);
		expect(html).toContain('Original record');
		expect(html).not.toContain('"price_data"');
	});

	it('keeps nested records and raw serialization out of primary rows', () => {
		const html = renderToStaticMarkup(createElement(ExplorerContractStateChangeTable, {
			rows: [{ id: 'many', ledger_sequence: '64877689', transaction_hash: hash,
				key_decoded: { vec: [{ symbol: 'feed' }, { string: 'EUROC/EUR' }] },
				val_decoded: { map: [{ key: { symbol: 'price_data' }, val: {
					vec: Array.from({ length: 10 }, () => ({ map: [
						{ key: { symbol: 'price' }, val: { u256: '123456789012345678901234567890123456789012345678901234567890123456789012345678' } }
					] }))
				} }] } }]
		}));
		expect(html).toContain('Price data · 10 records');
		expect((html.match(/<table/g) ?? [])).toHaveLength(1);
		expect(html).not.toContain('123456789012345678901234567890');
		expect(html).not.toContain('<pre');
		expect(html).not.toContain('<dialog');
		expect(html).toContain('aria-haspopup="dialog"');
		expect(html).toContain(hash);
		expect(html).toContain('Feed</span><span> / EUROC/EUR');
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
		expect(html).toContain('Details');
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
