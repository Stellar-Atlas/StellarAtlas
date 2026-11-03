import { jest } from '@jest/globals';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseContractActivityPage } from '../../../api/explorer-contract-activity';
import { initialContractActivityState } from '../explorer-contract-activity-model';
import { contractId, eventResponse } from './contract-activity-fixtures';
let search = '';
jest.unstable_mockModule('next/navigation', () => ({
	usePathname: () => '/explorer/contracts/' + contractId,
	useSearchParams: () => new URLSearchParams(search)
}));
jest.unstable_mockModule('../explorer-detail-dialog.module.css', () => ({ default: {} }));
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
	it('restores a shared state tab without event controls or event continuation', () => {
		search = '?activity=state&after=event-cursor';
		try {
			const html = renderToStaticMarkup(createElement(ExplorerContractActivity, {
				contractId, filters: { min_ledger: '63490364', max_ledger: '63490365', after: 'event-cursor' }
			}));
			expect(html).toContain('aria-pressed="true">State changes');
			expect(html).not.toContain('All events');
			expect(html).not.toContain('event-cursor');
		} finally { search = ''; }
	});
	it('renders restored event controls and the same REST selection despite old props', () => {
		search = '?order=asc&limit=50&type_code=1&topic=mint&q=account&after=next';
		try {
			const html = renderToStaticMarkup(createElement(ExplorerContractActivity, {
				contractId, filters: { min_ledger: '100', max_ledger: '101', order: 'desc', limit: '10' }
			}));
			expect(html).toContain('<option value="asc" selected="">Oldest first');
			expect(html).toContain('<option value="50" selected="">50');
			expect(html).toContain('type_code=1&amp;order=asc&amp;topic=mint&amp;q=account&amp;view=typed&amp;include_summary=true&amp;after=next');
			expect(html).not.toContain('events?limit=10');
		} finally { search = ''; }
	});
});
