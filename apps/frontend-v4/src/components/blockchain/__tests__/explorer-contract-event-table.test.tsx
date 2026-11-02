import { jest } from '@jest/globals';
import { createElement } from 'react';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { EntityRecord } from '../../../api/explorer-analytics';

// Exercise the actual Details handler without a browser or a replacement table.
let selected: EntityRecord | null = null;
jest.unstable_mockModule('react', () => ({
	...React,
	useState: () => [
		selected,
		(row: EntityRecord | null) => {
			selected = row;
		}
	]
}));

jest.unstable_mockModule('../explorer-contract-event-table.module.css', () => ({
	default: {}
}));
const { ExplorerContractEventTable } =
	await import('../explorer-contract-event-table');

const fullHash =
	'0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const fullAddress = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

beforeEach(() => {
	selected = null;
});

function detailsHandler(node: React.ReactNode): (() => void) | undefined {
	if (Array.isArray(node)) {
		for (const child of node) {
			const handler = detailsHandler(child);
			if (handler) return handler;
		}
	} else if (
		React.isValidElement<{
			children?: React.ReactNode;
			onClick?: () => void;
			'aria-haspopup'?: string;
		}>(node)
	) {
		if (node.props['aria-haspopup'] === 'dialog') return node.props.onClick;
		return detailsHandler(node.props.children);
	}
}

function openDetails(rows: readonly EntityRecord[]): string {
	const tree = ExplorerContractEventTable({ rows });
	expect(renderToStaticMarkup(tree)).not.toContain('<dialog');
	const open = detailsHandler(tree);
	expect(open).toBeDefined();
	open!();
	const html = renderToStaticMarkup(
		createElement(ExplorerContractEventTable, { rows })
	);
	expect(html).toContain('aria-labelledby="event-details-title"');
	return html;
}

describe('ExplorerContractEventTable', () => {
	it('renders decoded embedded XDR as flat exact typed fields and keeps full identifiers', () => {
		const html = openDetails([
			{
				id: 'event-1',
				ledgerSequence: '64877698',
				transactionHash: fullHash,
				topicsJson: JSON.stringify(['transfer', { address: fullAddress }]),
				dataJson: '{"bytes":"00ff"}',
				decodedBytes: {
					map: [
						{
							key: { symbol: 'updated_feeds' },
							val: {
								vec: [
									{
										map: [
											{
												key: { symbol: 'package_timestamp' },
												val: { u64: '1791674220000' }
											},
											{
												key: { symbol: 'price' },
												val: { u256: '170141183460469231731687303715884105727' }
											}
										]
									}
								]
							}
						}
					]
				},
				classification: { eventKind: 'contract', provenance: 'complete' }
			}
		]);
		expect(html).toContain('<h4>Topics</h4>');
		expect(html).toContain('Original record and XDR');
		expect(html).toContain('updated feeds[0].package timestamp');
		expect(html).toContain('dateTime="2026-10-10T23:17:00.000Z"');
		expect(html).toContain('1791674220000');
		expect(html).toContain('170141183460469231731687303715884105727');
		expect(html).toContain(
			'170,141,183,460,469,231,731,687,303,715,884,105,727'
		);
		expect(html).toContain(fullAddress);
		expect(html).toContain(fullHash);
		expect(html).toContain('Transaction result not recorded');
		expect(html).not.toContain('>Failed<');
	});

	it('links ledger, account, contract and transaction references with the correct ledger window', () => {
		const contractAddress =
			'CDL74RF5BLYR2YBLCCI7F5FB6TPSCLKEJUBSD2RSVWZ4YHF3VMFAIGWA';
		const html = openDetails([
			{
				id: 'linked',
				ledgerSequence: '64877698',
				transactionHash: fullHash,
				contractId: contractAddress,
				topicsJson: '[]',
				dataJson: JSON.stringify({
					ledger_sequence: '64877698',
					account: fullAddress,
					contract_address: contractAddress,
					transaction_hash: fullHash
				})
			}
		]);
		expect(html).toContain('href="/explorer/ledgers/64877698"');
		expect(html).toContain(`href="/explorer/accounts/${fullAddress}"`);
		expect(html).toContain(`href="/explorer/contracts/${contractAddress}"`);
		expect(html).toContain(
			`href="/explorer/transactions/${fullHash}?ledger_sequence=64877698"`
		);
	});

	it('renders empty containers as explicit values without recursive errors', () => {
		const html = renderToStaticMarkup(
			createElement(ExplorerContractEventTable, {
				rows: [
					{
						id: 'empty',
						ledgerSequence: '1',
						topicsJson: '[]',
						dataJson: '{"empty_map":{},"empty_list":[]}',
						classification: { eventKind: 'contract' },
						successful: false
					}
				]
			})
		);
		expect(html).toContain('empty map:');
		expect(html).toContain('empty list:');
		expect(html.match(/0 fields/g)).toHaveLength(2);
		expect(html).toContain('aria-label="Transaction failed"');
	});

	it('keeps malformed or unrecognized bytes readable as a binary fallback', () => {
		const html = renderToStaticMarkup(
			createElement(ExplorerContractEventTable, {
				rows: [{ id: 'binary', topicsJson: '[]', dataJson: '{"bytes":"ff00"}' }]
			})
		);
		expect(html).toContain('<code>2 bytes</code>');
		expect(html).toContain('Transaction result not recorded');
		expect(html).not.toContain('Transaction failed');
	});

	it('escapes hostile strings and shows full transaction hashes', () => {
		const hostile = '<img src=x onerror=alert(1)>';
		const html = renderToStaticMarkup(
			createElement(ExplorerContractEventTable, {
				rows: [
					{
						id: 'hostile',
						ledgerSequence: '2',
						transactionHash: fullHash,
						topicsJson: JSON.stringify([hostile]),
						dataJson: JSON.stringify({ note: hostile })
					}
				]
			})
		);
		expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
		expect(html).not.toContain('<img src=x onerror=alert(1)>');
		expect(html).toContain(fullHash);
	});
});
