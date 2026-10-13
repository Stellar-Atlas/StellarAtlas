import { jest } from '@jest/globals';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

jest.unstable_mockModule('../explorer-contract-event-table.module.css', () => ({
	default: {}
}));
const { ExplorerContractEventTable } = await import('../explorer-contract-event-table');

const fullHash = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const fullAddress = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

describe('ExplorerContractEventTable', () => {
	it('renders decoded embedded XDR as flat exact typed fields and keeps full identifiers', () => {
		const html = renderToStaticMarkup(createElement(ExplorerContractEventTable, {
			rows: [{
				id: 'event-1',
				ledgerSequence: '64877698',
				transactionHash: fullHash,
				topicsJson: JSON.stringify(['transfer', { address: fullAddress }]),
				dataJson: '{"bytes":"00ff"}',
				decodedBytes: {
					map: [{
						key: { symbol: 'updated_feeds' },
						val: { vec: [{ map: [
							{ key: { symbol: 'package_timestamp' }, val: { u64: '1791674220000' } },
							{ key: { symbol: 'price' }, val: { u256: '170141183460469231731687303715884105727' } }
						] }] }
					}]
				},
				classification: { eventKind: 'contract', provenance: 'complete' },

			}]
		}));
		expect(html).toContain('aria-label="Topics"');
		expect(html).toContain('Decoded from XDR bytes');
		expect(html).toContain("<span>Package timestamp</span>");
		expect(html).toContain("title=\"updated_feeds[0].package_timestamp · u64\"");
		expect(html).toContain('1791674220000');
		expect(html).toContain('170141183460469231731687303715884105727');
		expect(html).not.toContain('symbol');
		expect(html).toContain(fullAddress);
		expect(html).toContain(fullHash);
		expect(html).toContain('Outcome not recorded');
		expect(html).not.toContain('>Failed<');
	});

	it("links ledger, account, contract and transaction references with the correct ledger window", () => {
		const contractAddress = "CDL74RF5BLYR2YBLCCI7F5FB6TPSCLKEJUBSD2RSVWZ4YHF3VMFAIGWA";
		const html = renderToStaticMarkup(createElement(ExplorerContractEventTable, {
			rows: [{
				id: "linked", ledgerSequence: "64877698", topicsJson: "[]",
				dataJson: JSON.stringify({ ledger_sequence: "64877698", account: fullAddress, contract_address: contractAddress, transaction_hash: fullHash })
			}]
		}));
		expect(html).toContain("href=\"/explorer/ledgers/64877698\"");
		expect(html).toContain(`href="/explorer/accounts/${fullAddress}"`);
		expect(html).toContain(`href="/explorer/contracts/${contractAddress}?min_ledger=64877698&amp;max_ledger=64877698"`);
		expect(html).toContain(`href="/explorer/transactions/${fullHash}?ledger_sequence=64877698"`);
	});

	it('renders empty containers as explicit values without recursive errors', () => {
		const html = renderToStaticMarkup(createElement(ExplorerContractEventTable, {
			rows: [{
				id: 'empty', ledgerSequence: '1', topicsJson: '[]',
				dataJson: '{"empty_map":{},"empty_list":[]}',
				classification: { eventKind: 'contract' }, successful: false
			}]
		}));
		expect(html).toContain('empty_map');
		expect(html).toContain('Empty map');
		expect(html).toContain('empty_list');
		expect(html).toContain('Empty list');
		expect(html).toContain('Failed');
	});

	it('keeps malformed or unrecognized bytes readable as a binary fallback', () => {
		const html = renderToStaticMarkup(createElement(ExplorerContractEventTable, {
			rows: [{ id: 'binary', topicsJson: '[]', dataJson: '{"bytes":"ff00"}' }]
		}));
		expect(html).toContain('Binary payload · 2 bytes');
		expect(html).toContain('Outcome not recorded');
		expect(html).not.toContain('Transaction failed');
	});

	it('escapes hostile strings and shows full transaction hashes', () => {
		const hostile = '<img src=x onerror=alert(1)>';
		const html = renderToStaticMarkup(createElement(ExplorerContractEventTable, {
			rows: [{
				id: 'hostile', ledgerSequence: '2', transactionHash: fullHash,
				topicsJson: JSON.stringify([hostile]), dataJson: JSON.stringify({ note: hostile })
			}]
		}));
		expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
		expect(html).not.toContain('<img src=x onerror=alert(1)>');
		expect(html).toContain(fullHash);
	});
});
