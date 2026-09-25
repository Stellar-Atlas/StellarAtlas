import { jest } from '@jest/globals';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { contractEventExample } from '../contract-event-query';
jest.unstable_mockModule('../explorer-entity.module.css', () => ({
	default: {}
}));
jest.unstable_mockModule('../explorer-contract-events.module.css', () => ({
	default: {}
}));
const { ExplorerContractEvents } = await import('../explorer-contract-events');

describe('contract events workspace', () => {
	it('starts without a query and offers a real imported example', () => {
		const html = renderToStaticMarkup(
			createElement(ExplorerContractEvents, { filters: {} })
		);
		expect(html).toContain('Start with a contract and ledger range');
		expect(html).toContain('Try an imported example');
		expect(html).toContain('method="get"');
		expect(html).toContain('/docs/contract-events');
		expect(html).not.toContain('Loading contract events');
	});
	it('renders typed event results and public request links for a valid query', () => {
		const html = renderToStaticMarkup(
			createElement(ExplorerContractEvents, { filters: contractEventExample })
		);
		expect(html).toContain('Loading contract events');
		expect(html).toContain(
			'https://api.stellaratlas.io/v1/analytics/contracts/'
		);
		expect(html).toContain('view=typed');
		expect(html).toContain('Contract-call outcome');
		expect(html).toContain('name="successful"');
	});
	it('does not fetch when the requested interval is invalid', () => {
		const html = renderToStaticMarkup(
			createElement(ExplorerContractEvents, {
				filters: { ...contractEventExample, max_ledger: '1' }
			})
		);
		expect(html).toContain('role="alert"');
		expect(html).not.toContain('Loading contract events');
		expect(html).not.toContain('Open REST response');
	});
});
