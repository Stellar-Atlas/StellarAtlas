import { jest } from '@jest/globals';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseContractActivityPage } from '../../../api/explorer-contract-activity';
import { initialContractActivityState } from '../explorer-contract-activity-model';
import { contractId, eventResponse } from './contract-activity-fixtures';
jest.unstable_mockModule('../explorer-entity.module.css', () => ({
	default: {}
}));
jest.unstable_mockModule('../explorer-contract-event-table.module.css', () => ({
	default: {}
}));
jest.unstable_mockModule(
	'../explorer-contract-state-change-table.module.css',
	() => ({ default: {} })
);
jest.unstable_mockModule('../explorer-contract-controls.module.css', () => ({
	default: {}
}));
const { ContractActivityView, ExplorerContractActivity } =
	await import('../explorer-contract-activity');
const page = parseContractActivityPage(
	eventResponse('next'),
	contractId,
	'events'
);
const actions = {
	onRetry: () => {},
	onPrevious: () => {},
	onNext: () => {},
	onRefresh: () => {}
};

describe('typed contract activity presentation', () => {
	it('shows concise typed event fields and exact original numeric text', () => {
		const html = renderToStaticMarkup(
			createElement(ContractActivityView, {
				...actions,
				tab: 'events',
				state: { ...initialContractActivityState, page, loading: false }
			})
		);
		expect(html).toContain('2 topics');
		expect(html).toContain('Details');
		expect(html).toContain('/explorer/ledgers/63490364');
		expect(html).toContain(
			'170,141,183,460,469,231,731,687,303,715,884,105,727'
		);
		expect(html).toContain('Transaction succeeded');
		expect(html).toContain(
			'/explorer/transactions/abc123?ledger_sequence=63490364'
		);
		expect(page.watermark).toMatchObject({
			minimumLedger: 63490364,
			maximumLedger: 63490365
		});
		expect(html).not.toContain('No activity exists');
		expect(html).toContain('Contract events');
		expect(html).not.toContain('Typed event record and original XDR');
	});
	it('renders failures with a retry button while retaining and accurately labeling old results', () => {
		const html = renderToStaticMarkup(
			createElement(ContractActivityView, {
				...actions,
				tab: 'events',
				state: {
					...initialContractActivityState,
					page,
					loading: false,
					error: 'HTTP 503'
				}
			})
		);
		expect(html).toContain('role="alert"');
		expect(html).toContain('>Retry</button>');
		expect(html).toContain('Showing previous results.');
		expect(html).toContain('/explorer/ledgers/63490364');
		expect(html).toContain(
			'/explorer/transactions/abc123?ledger_sequence=63490364'
		);
		expect(html).not.toContain('No events in this imported window.');
	});
	it('does not label empty imported pages as complete absence on the network', () => {
		const html = renderToStaticMarkup(
			createElement(ContractActivityView, {
				...actions,
				tab: 'events',
				state: {
					...initialContractActivityState,
					page: { ...page, rows: [], nextPosition: null },
					loading: false
				}
			})
		);
		expect(html).toContain('No events in this imported window.');
		expect(html).not.toContain('No activity exists');
	});
	it('keeps contract/window-specific result components and separate state-history semantics', () => {
		const html = renderToStaticMarkup(
			createElement(ExplorerContractActivity, {
				contractId,
				filters: { min_ledger: '63490364', max_ledger: '63490365' }
			})
		);
		expect(html).toContain('State changes');
		expect(html).toContain('All events');
		expect(html).toContain('Loading…');
	});
});
