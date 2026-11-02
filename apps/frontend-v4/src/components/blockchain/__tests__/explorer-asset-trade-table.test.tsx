import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { jest } from '@jest/globals';
jest.unstable_mockModule('../explorer-entity.module.css', () => ({ default: {} }));
jest.unstable_mockModule('../explorer-asset-workspace.module.css', () => ({ default: {} }));
jest.unstable_mockModule('../explorer-asset-pair', () => ({
	usePairMetadata: () => ({}),
	ExplorerAssetPair: () => createElement('span', null, 'USD / XLM')
}));
const { ExplorerAssetTradeTable } = await import('../explorer-asset-trade-table');
it('labels mobile values together and preserves source decimal text and accepted-window links', () => {
	const issuer = 'G' + 'A'.repeat(55);
	const html = renderToStaticMarkup(createElement(ExplorerAssetTradeTable, {
		window: { minLedger: 99, maxLedger: 101 }, rows: [{ id: 'trade', operationId: '429496729603',
			sellingAsset: { id: 'USD:' + issuer, code: 'USD' }, buyingAsset: { id: 'native' },
			sellingAmount: '9007199254740993.1234567', buyingAmount: '1.2300000', ledgerSequence: 100,
			closedAt: '2026-11-02T01:00:00Z' }]
	}));
	for (const label of ['Pair', 'Sold → bought', 'Operation', 'Ledger', 'Time', 'Report']) expect(html).toContain('data-label="' + label + '"');
	expect(html).toContain('9,007,199,254,740,993.1234567');
	expect(html).toContain('1.23');
	expect(html).toContain('/explorer/operations/429496729603');
	expect(html).toContain('/explorer/ledgers/100');
	expect(html).toContain('asset_a=USD%3A' + issuer + '&amp;asset_b=native&amp;min_ledger=99&amp;max_ledger=101');
	expect(html).not.toContain('…');
});
