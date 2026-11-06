import { readTransactionActivityRoute, resolveTypedTransactionLedger, restoreTransactionRelation, transactionActivityHref, transactionActivityKey, transactionRelationPositionKey } from '../transaction-activity-route';

describe('transaction activity URL selection', () => {
	it('binds only a valid matching typed transaction ledger, including failed on-chain transactions', () => {
		const hash = 'ab'.repeat(32);
		const transaction = { hash: hash.toUpperCase(), ledgerSequence: 64877689, successful: false };
		expect(resolveTypedTransactionLedger(hash, '', transaction)).toBe('64877689');
		expect(resolveTypedTransactionLedger(hash, '64877689', transaction)).toBe('64877689');
		expect(() => resolveTypedTransactionLedger(hash, '64877688', transaction)).toThrow('different ledger');
		expect(() => resolveTypedTransactionLedger(hash, '', { ...transaction, hash: 'cd'.repeat(32) })).toThrow('different transaction');
		for (const ledgerSequence of [undefined, '64877689', 0, 1.5, 2_147_483_648])
			expect(() => resolveTypedTransactionLedger(hash, '', { ...transaction, ledgerSequence })).toThrow('invalid transaction ledger');
	});
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
	it('restores only the failed relation and keeps predecessor identity independent of other pages', () => {
		const route = { ledger: '100', cursors: { operations: 'op-next', effects: 'effects-current', events: 'events-current' } };
		const otherPages = { ...route, cursors: { ...route.cursors, effects: 'different' } };
		expect(transactionRelationPositionKey(route, 'operations')).toBe(transactionRelationPositionKey(otherPages, 'operations'));
		expect(transactionRelationPositionKey(route, 'operations')).not.toBe(transactionRelationPositionKey({ ...route, ledger: '101' }, 'operations'));
		expect(restoreTransactionRelation(route, 'operations', 'op-previous')).toEqual({
			...route, cursors: { ...route.cursors, operations: 'op-previous' }
		});
		expect(restoreTransactionRelation(route, 'operations', undefined)).toEqual({
			ledger: '100', cursors: { effects: 'effects-current', events: 'events-current' }
		});
	});
});
