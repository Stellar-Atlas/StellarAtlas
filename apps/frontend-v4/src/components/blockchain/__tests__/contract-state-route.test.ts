import { contractActivityPath } from '../../../api/explorer-contract-activity';
import { contractActivityUrlIdentity } from '../contract-event-route';
import { contractIdentityFilters, preserveContractActivityContext, readStateRoute, statePositionHref } from '../contract-state-route';

const contract = 'C-test';
const first = 'activity=state&min_ledger=100&max_ledger=101&ledger_key_hash=key&durability=persistent&deleted=false&after=event-cursor&topic=mint&tab=contracts-events&return_to=%2Fexplorer';
describe('state selection and continuation', () => {
	it('uses explicit embedded bounds and only state fields in the API request', () => {
		const route = readStateRoute(contract, {}, new URLSearchParams(first));
		expect(contractActivityPath(contract, 'state', route.filters, route.position)).toBe('/v1/analytics/contracts/C-test/state?limit=25&min_ledger=100&max_ledger=101&ledger_key_hash=key&durability=persistent&deleted=false&offset=0');
	});
	it('restores a bound offset and preserves the event, asset, return and anchor context', () => {
		const route = readStateRoute(contract, {}, new URLSearchParams(first));
		const href = statePositionHref('/explorer/assets/USD', first, route, '25', '#activity');
		const url = new URL(href, 'https://example.invalid');
		const restored = readStateRoute(contract, {}, url.searchParams);
		expect(restored).toMatchObject({ position: '25', normalize: false });
		expect(url.hash).toBe('#activity');
		for (const key of ['after', 'topic', 'tab', 'return_to']) expect(url.searchParams.get(key)).toBe(new URLSearchParams(first).get(key));
		expect(contractActivityPath(contract, 'state', restored.filters, restored.position)).toContain('offset=25');
		expect(statePositionHref(url.pathname, url.search, restored, '', url.hash)).toBe('/explorer/assets/USD?' + first + '#activity');
	});
	it('resets continuation only for a changed state selection, not event controls', () => {
		const route = readStateRoute(contract, {}, new URLSearchParams(first));
		const next = new URL(statePositionHref('/state', first, route, '25'), 'https://example.invalid');
		for (const [key, value] of [['min_ledger', '99'], ['max_ledger', '102'], ['ledger_key_hash', 'other'], ['durability', 'temporary'], ['deleted', 'true'], ['limit', '50']]) {
			const changed = new URLSearchParams(next.search);
			changed.set(key!, value!);
			expect(readStateRoute(contract, {}, changed)).toMatchObject({ position: '', normalize: true });
		}
		next.searchParams.set('after', 'another-event-page');
		next.searchParams.set('topic', 'transfer');
		expect(readStateRoute(contract, {}, next.searchParams)).toMatchObject({ position: '25', normalize: false });
	});
	it('migrates a legacy numeric offset into state-only continuation', () => {
		const params = new URLSearchParams(first + '&offset=25');
		const route = readStateRoute(contract, {}, params);
		expect(route).toMatchObject({ position: '25', normalize: true });
		const restored = new URL(statePositionHref('/state', params.toString(), route, route.position), 'https://example.invalid');
		expect(restored.searchParams.has('offset')).toBe(false);
		expect(readStateRoute(contract, {}, restored.searchParams)).toMatchObject({ position: '25', normalize: false });
	});
	it('rejects invalid or repeated bounds, filters and unsafe offsets before requests', () => {
		for (const query of ['min_ledger=0', 'min_ledger=', 'min_ledger=102&max_ledger=101', 'min_ledger=1&min_ledger=2', 'max_ledger=NaN', 'deleted=maybe', 'durability=', 'limit=500', 'offset=-1', 'offset=9007199254740992', 'state_offset=25'])
			expect(() => readStateRoute(contract, {}, new URLSearchParams(query))).toThrow();
	});
	it('pins the generic contract window without losing state continuation', () => {
		const destination = preserveContractActivityContext('/explorer/contracts/C-test?min_ledger=100&max_ledger=101&after=event-cursor', first + '&state_offset=25&state_for=identity');
		const params = new URL(destination, 'https://example.invalid').searchParams;
		for (const key of ['activity', 'ledger_key_hash', 'durability', 'deleted', 'after', 'state_offset', 'state_for']) expect(params.has(key)).toBe(true);
	});
	it('keeps child filters out of the parent identity lookup without dropping shared context', () => {
		const filters = { min_ledger: '100', max_ledger: '101', limit: '25', deleted: 'false', after: 'events', topic: 'mint', order: 'asc', q: '100' };
		expect(contractIdentityFilters(filters)).toEqual({ min_ledger: '100', max_ledger: '101', limit: '25' });
		const pinned = new URL(preserveContractActivityContext('/explorer/contracts/C-test?min_ledger=100&max_ledger=101', new URLSearchParams(filters).toString()), 'https://example.invalid');
		for (const key of ['deleted', 'after', 'topic', 'order', 'q']) expect(pinned.searchParams.get(key)).toBe(filters[key as keyof typeof filters]);
	});
	it('rejects late responses across state pages but not unrelated event-page changes', () => {
		const identity = contractActivityUrlIdentity(first, 'state');
		expect(contractActivityUrlIdentity(first + '&state_offset=25&state_for=x', 'state')).not.toBe(identity);
		expect(contractActivityUrlIdentity(first.replace('event-cursor', 'other'), 'state')).toBe(identity);
	});
});
