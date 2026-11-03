import { contractActivityPath } from '../../../api/explorer-contract-activity';
import { createEventControls } from '../contract-event-controls';
import { contractActivityUrlIdentity, eventControlsHref, eventPositionHref, readEventRoute, readEventRouteInput } from '../contract-event-route';
import { contractEventExample, contractEventQueryError } from '../contract-event-query';

describe('event selection URL contract', () => {
	it('restores URL selection instead of stale initial controls and cursor', () => {
		const filters = { min_ledger: '100', max_ledger: '101', order: 'desc', limit: '10', type_code: '2', topic: 'old', q: 'old', after: 'old-cursor' };
		const restored = readEventRoute(filters, new URLSearchParams('order=asc&limit=50&after=next'));
		expect(createEventControls(restored)).toEqual({ order: 'asc', limit: '50', type: 'all', topic: '', q: '' });
		expect(restored.after).toBe('next');
		expect(contractActivityPath('C-test', 'events', restored)).toContain('limit=50&min_ledger=100&max_ledger=101&order=asc&view=typed&include_summary=true&after=next');
		expect(readEventRoute(filters, new URLSearchParams())).toEqual({ min_ledger: '100', max_ledger: '101', order: 'desc', limit: '25' });
	});
	it('commits controls, clearing only continuation while preserving investigation context', () => {
		const before = '?contract_id=C-test&min_ledger=100&max_ledger=101&successful=false&transaction_hash=abc&activity=events&tab=contracts&return_to=%2Fexplorer%3Fq%3DUSD&after=old&offset=25';
		const href = eventControlsHref('/explorer/assets/USD', before, { type: '1', order: 'asc', limit: '50', topic: ' mint ', q: ' account ' }, '#events');
		const url = new URL(href, 'https://example.invalid');
		expect(url.pathname).toBe('/explorer/assets/USD');
		expect(url.hash).toBe('#events');
		expect(Object.fromEntries(url.searchParams)).toEqual({ contract_id: 'C-test', min_ledger: '100', max_ledger: '101', successful: 'false', transaction_hash: 'abc', activity: 'events', tab: 'contracts', return_to: '/explorer?q=USD', type_code: '1', order: 'asc', limit: '50', topic: 'mint', q: 'account' });
	});
	it('changes just the selected page and restores the first page without dropping filters', () => {
		const first = '/explorer/contract-events?order=asc&limit=50&topic=mint&return_to=%2Fexplorer#events';
		const url = new URL(first, 'https://example.invalid');
		const next = eventPositionHref(url.pathname, url.search, 'opaque+/cursor=', url.hash);
		const nextUrl = new URL(next, url.origin);
		expect(nextUrl.searchParams.get('after')).toBe('opaque+/cursor=');
		expect(eventPositionHref(url.pathname, nextUrl.search, '', nextUrl.hash)).toBe(first);
	});
	it('retains invalid raw URL controls for validation instead of silently widening them', () => {
		const input = readEventRouteInput(contractEventExample, new URLSearchParams('order=sideways&limit=500'));
		expect(input.order).toBe('sideways');
		expect(contractEventQueryError(input)).toBe('Choose newest or oldest events first.');
	});
	it('ignores URL ordering and return context but rejects a different data selection', () => {
		const original = '?min_ledger=100&max_ledger=101&q=account&limit=25&return_to=%2Fexplorer';
		const identity = contractActivityUrlIdentity(original, 'events');
		expect(contractActivityUrlIdentity('?return_to=%2Fother&order=desc&limit=25&q=account&max_ledger=101&min_ledger=100', 'events')).toBe(identity);
		for (const change of ['&after=next', '&topic=mint', '&type_code=1', '&successful=false', '&activity=state'])
			expect(contractActivityUrlIdentity(original + change, 'events')).not.toBe(identity);
		expect(contractActivityUrlIdentity(original.replace('max_ledger=101', 'max_ledger=102'), 'events')).not.toBe(identity);
	});
});
