import { contractActivityTabHref, readContractActivityTab } from '../contract-activity-route';

describe('contract activity URL state', () => {
	it('restores state and safely defaults every other value to events', () => {
		expect(readContractActivityTab('state')).toBe('state');
		for (const value of [null, '', 'events', 'STATE', 'unknown', '__proto__'])
			expect(readContractActivityTab(value)).toBe('events');
	});
	it('preserves the enclosing asset tab, range, cursor, repeated filters and anchor', () => {
		const href = contractActivityTabHref('/explorer/assets/native',
			'?tab=contracts-events&min_ledger=10&max_ledger=20&after=opaque%2Bcursor&tag=a&tag=b&return_to=%2Fexplorer',
			'state', '#activity');
		const url = new URL(href, 'https://explorer.invalid');
		expect(url.pathname).toBe('/explorer/assets/native');
		expect(url.searchParams.get('activity')).toBe('state');
		expect(url.searchParams.get('tab')).toBe('contracts-events');
		expect(url.searchParams.get('min_ledger')).toBe('10');
		expect(url.searchParams.get('max_ledger')).toBe('20');
		expect(url.searchParams.get('after')).toBe('opaque+cursor');
		expect(url.searchParams.get('return_to')).toBe('/explorer');
		expect(url.searchParams.getAll('tag')).toEqual(['a', 'b']);
		expect(url.hash).toBe('#activity');
	});
	it('uses the default events URL and normalizes duplicate activity values', () => {
		expect(contractActivityTabHref('/explorer/contracts/C', '?activity=state', 'events'))
			.toBe('/explorer/contracts/C');
		const href = contractActivityTabHref('/explorer/contracts/C', '?activity=events&activity=state&after=c', 'state');
		const url = new URL(href, 'https://explorer.invalid');
		expect(url.searchParams.getAll('activity')).toEqual(['state']);
		expect(url.searchParams.get('after')).toBe('c');
	});
});
