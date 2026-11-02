import { readTransactionActivityRoute, transactionActivityHref, transactionActivityKey } from '../transaction-activity-route';

describe('transaction activity URL selection', () => {
	it('round-trips exact independent opaque cursors, ledger and return context', () => {
		const route = { ledger: '65213961', cursors: { operations: 'op+/=', effects: 'effects', events: 'events' } };
		const url = new URL(transactionActivityHref('/explorer/transactions/hash-A', '?return_to=%2Fexplorer&unrelated=keep', route, 'hash-A', '#events'), 'http://fixture.invalid');
		expect(readTransactionActivityRoute(url.searchParams, 'hash-A')).toEqual(route);
		expect(url.searchParams.get('return_to')).toBe('/explorer');
		expect(url.searchParams.get('unrelated')).toBe('keep');
		expect(url.hash).toBe('#events');
		expect(readTransactionActivityRoute(url.searchParams, 'hash-B').cursors).toEqual({});
	});
	it('rejects foreign, unbound, repeated, oversized and control-bearing continuation', () => {
		for (const query of ['operations_after=c', 'activity_for=hash-A&activity_for=hash-A&operations_after=c', 'activity_for=hash-A&operations_after=a&operations_after=b', 'activity_for=hash-A&operations_after=%00bad', 'activity_for=hash-A&operations_after=' + 'x'.repeat(2049)]) {
			expect(readTransactionActivityRoute(new URLSearchParams(query), 'hash-A').cursors).toEqual({});
		}
		for (const ledger of ['0', '01', '-1', '4294967296', 'no']) expect(readTransactionActivityRoute(new URLSearchParams({ ledger_sequence: ledger }), 'hash-A').ledger).toBe('');
	});
	it('clears all continuation on a new ledger and canonicalizes relation ordering', () => {
		const url = new URL(transactionActivityHref('/explorer/transactions/hash-A', '?ledger_sequence=100&activity_for=hash-A&operations_after=old&events_after=old', { ledger: '101', cursors: {} }, 'hash-A'), 'http://fixture.invalid');
		expect([...url.searchParams.entries()]).toEqual([['ledger_sequence', '101']]);
		expect(transactionActivityKey({ ledger: '', cursors: { events: 'e', operations: 'o' } })).toBe(transactionActivityKey({ ledger: '', cursors: { operations: 'o', events: 'e' } }));
	});
});
