import { jest } from '@jest/globals';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
jest.unstable_mockModule('../explorer-entity.module.css', () => ({
	default: {}
}));
const { ExplorerEntityNavigation } =
	await import('../explorer-entity-navigation');
const { ExplorerEntityTable, ExplorerEntityDetails } =
	await import('../explorer-entity-table');
describe('parsed explorer presentation', () => {
	it('shows native pool observations, nullable removals and correctly scoped pair-trade links', () => {
		const html = renderToStaticMarkup(
			createElement(ExplorerEntityDetails, {
				collection: 'liquidity-pools',
				filters: { min_ledger: '63491202', max_ledger: '63491202' },
				row: {
					id: 'pool',
					assetA: { id: 'native' },
					assetB: { id: 'USD:GABC', code: 'USD' },
					reserveA: '1635.3635675',
					deleted: false
				}
			})
		);
		expect(html).toContain('Reserve A');
		expect(html).toContain('1635.3635675');
		expect(html).toContain('selling_asset=native');
		expect(html).toContain('buying_asset=native');
		expect(html).toContain('(all venues)');
		const removed = renderToStaticMarkup(
			createElement(ExplorerEntityTable, {
				collection: 'liquidity-pools',
				filters: {},
				rows: [{ id: 'pool', deleted: true, reserveA: null }]
			})
		);
		expect(removed).toContain('Removed');
		expect(removed).not.toContain('Open at observation');
	});
	it('does not label an unrecorded trade counterparty as a native asset', () => {
		const html = renderToStaticMarkup(
			createElement(ExplorerEntityTable, {
				collection: 'trades',
				filters: {},
				rows: [{ id: 'trade', seller: null, buyer: null }]
			})
		);
		expect(html).toContain('Not recorded');
		expect(html).not.toContain('Native asset');
	});
	it('pins trade-to-operation navigation to the observed ledger', () => {
		const html = renderToStaticMarkup(
			createElement(ExplorerEntityDetails, {
				collection: 'trades',
				filters: {},
				row: { id: 'trade', operationId: 'op', ledgerSequence: 63490364 }
			})
		);
		expect(html).toContain(
			'/explorer/operations/op?min_ledger=63490364&amp;max_ledger=63490364'
		);
	});
	it('exposes all working browse routes including trades and offers', () => {
		const html = renderToStaticMarkup(
			createElement(ExplorerEntityNavigation, { active: 'trades' })
		);
		for (const collection of [
			'operations',
			'assets',
			'contracts',
			'trades',
			'offers',
			'liquidity-pools',
			'transfers'
		])
			expect(html).toContain('/explorer/' + collection);
		expect(html).toContain('aria-current="page"');
	});
	it('never links a numeric transaction TOID as though it were a hash', () => {
		const html = renderToStaticMarkup(
			createElement(ExplorerEntityTable, {
				collection: 'operations',
				filters: {},
				rows: [
					{
						id: '272689036992143361',
						transactionId: '272689036992143360',
						transactionHash: null
					}
				]
			})
		);
		expect(html).not.toContain('/explorer/transactions/272689036992143360');
		expect(html).toContain('No transaction hash published');
	});
	it('links real operation hashes with a bounded ledger hint', () => {
		const html = renderToStaticMarkup(
			createElement(ExplorerEntityTable, {
				collection: 'operations',
				filters: {},
				rows: [
					{
						id: '7',
						transactionId: '6',
						transactionHash: 'abc',
						ledgerSequence: 63490364
					}
				]
			})
		);
		expect(html).toContain(
			'/explorer/transactions/abc?ledger_sequence=63490364'
		);
	});
	it('offers related asset history rather than fake current state', () => {
		const html = renderToStaticMarkup(
			createElement(ExplorerEntityDetails, {
				collection: 'assets',
				filters: { min_ledger: '3', max_ledger: '64' },
				row: { id: 'native', type: 'native' }
			})
		);
		expect(html).toContain('selling_asset=native');
		expect(html).toContain('buying_asset=native');
		expect(html).toContain('Offer history');
	});
});
