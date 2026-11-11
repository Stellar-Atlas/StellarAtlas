import { jest } from '@jest/globals';
import { HookHarness } from '../../blockchain/__tests__/asset-workspace-hook-harness';
import * as analytics from '../../../api/explorer-analytics';
import { withExplorerReturnTo } from '../../../api/explorer-return-context';

const base = 'https://fixture.invalid';
const account = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const start = '/explorer/transfers?account=' + account + '&asset=native&event_topic=transfer&return_to=%2Fexplorer%2Faccounts%2F' + account;
const hash = 'a'.repeat(64);
let route = new URL(start, base), unavailable = false;
const hooks = new HookHarness();
const request = jest.fn(async (path: string, _signal?: AbortSignal): Promise<unknown> => {
	const query = new URL(path, base).searchParams;
	const after = query.get('after');
	if (after && unavailable) throw new Error('HTTP 503: Fixture unavailable');
	if (after === 'unbounded' && query.has('max_ledger')) throw new Error('Implicit cursor fingerprint changed');
	if (after === 'pinned' && !query.has('max_ledger')) throw new Error('Pinned cursor window dropped');
	const row = {id: after ? 'second' : 'first', ledgerSequence: 100, closedAt: '2026-11-03T00:00:00.000Z',
		transactionHash: hash, transactionId:'429496729600', operationId:null, from:account, to:null, toMuxed:null,
		asset:{id:'native', type:'native', code:'XLM', issuer:null}, contractId:'', eventTopic:'transfer', amountRaw:'10000000', amountScale:7};
	return {transfers:[row, {...row,id:'missing',transactionHash:undefined}, {...row,id:'malformed',transactionHash:'bad/hash'}],
		nextCursor:after ? null : query.has('max_ledger') ? 'pinned' : 'unbounded', limit:Number(query.get('limit')),
		watermark:{minimumLedger:2,maximumLedger:100,observedAt:row.closedAt,coverage:'ingested-only'}, elapsedMilliseconds:1};
});
jest.unstable_mockModule('react', () => ({useEffect:hooks.useEffect,useRef:hooks.useRef,useState:hooks.useState}));
jest.unstable_mockModule('next/navigation', () => ({usePathname:() => route.pathname,useSearchParams:() => route.searchParams}));
jest.unstable_mockModule('../../../api/explorer-analytics', () => ({
	...analytics,
	requestExplorerJson: request
}));
const { useTransferInvestigation } = await import('../use-transfer-investigation');
const { transferTransactionReference } = await import('../transfer-investigation-route');
const render = () => hooks.render(useTransferInvestigation);
const settle = async () => {
	render();
	await new Promise<void>(resolve => setImmediate(resolve));
	return render();
};
const params = (call: number) => {
	const path = request.mock.calls[call]?.[0];
	if (!path) throw new Error('Missing expected request ' + call);
	return new URL(path, base).searchParams;
};
beforeEach(() => {
	route = new URL(start, base); unavailable = false; request.mockClear();
	const setLocation = (_state: unknown, _title: string, href: string) => { route = new URL(href, base); };
	Object.defineProperty(globalThis, 'window', {configurable:true,value:{
		get location() { return route; }, history:{ pushState:setLocation, replaceState:setLocation }
	}});
});
afterEach(() => { hooks.reset(); Reflect.deleteProperty(globalThis,'window'); });

it('keeps account, asset, time, ledger window and the exact continuation in transaction return and Back/Forward', async () => {
	const initial = await settle();
	expect(request).not.toHaveBeenCalled();
	initial.submit({...initial.filters, start_time:'2026-11-02T04:05:06.000Z'});
	const first = await settle(), firstUrl = route.href;
	expect(route.searchParams.get('transfer_window')).toBe('2:100');
	expect(request).toHaveBeenCalledTimes(1);
	expect(params(0).get('limit')).toBe('25');
	expect(params(0).has('max_ledger')).toBe(false);
	first.next?.();
	const second = await settle(), secondUrl = route.href;
	expect(route.searchParams.get('transfer_window')).toBe('2:100');
	expect(second.page?.transfers[0]?.id).toBe('second');
	expect(params(1).get('after')).toBe('unbounded');
	expect(params(1).has('max_ledger')).toBe(false);
	const reference = transferTransactionReference(hash.toUpperCase(),100);
	const tx = new URL(withExplorerReturnTo(reference.href!, second.href), base);
	expect(tx.pathname).toBe('/explorer/transactions/' + hash);
	expect(tx.searchParams.get('ledger_sequence')).toBe('100');
	const back = new URL(tx.searchParams.get('return_to')!, base);
	expect(back.searchParams.has('return_to')).toBe(false);
	for (const [key,value] of Object.entries({account, asset:'native', event_topic:'transfer',
		start_time:'2026-11-02T04:05:06.000Z', transfer_after:'unbounded'})) expect(back.searchParams.get(key)).toBe(value);
	expect(second.page?.transfers[1]?.transactionHash).toBe('');
	expect(transferTransactionReference('',100)).toEqual({href:null,label:'Not recorded'});
	expect(transferTransactionReference('bad/hash',100)).toEqual({href:null,label:'Invalid transaction hash'});
	route = new URL(firstUrl);
	const restoredFirst = await settle();
	expect(restoredFirst.page?.transfers[0]?.id).toBe('first');
	expect([params(2).get('min_ledger'),params(2).get('max_ledger')]).toEqual(['2','100']);
	route = new URL(secondUrl);
	expect((await settle()).page?.transfers[0]?.id).toBe('second');
	hooks.reset(); route = back;
	expect((await settle()).page?.transfers[0]?.id).toBe('second');
	expect(params(4).get('after')).toBe('unbounded');
	route = new URL(firstUrl);
	(await settle()).next?.();
	expect((await settle()).page?.transfers[0]?.id).toBe('second');
	expect([params(6).get('after'),params(6).get('max_ledger')]).toEqual(['pinned','100']);
});

it.each(['25', '50', '100'])('retains %s rows through next/previous, direct links, reload and changed page size', async size => {
	const initial = await settle();
	initial.changePageSize(size);
	const first = await settle(), firstUrl = route.href;
	expect(first.pageSize).toBe(Number(size));
	expect(params(0).get('limit')).toBe(size);
	expect(route.searchParams.get('limit')).toBe(size);
	first.next?.();
	const second = await settle(), secondUrl = route.href;
	expect(params(1).get('limit')).toBe(size);
	expect(route.searchParams.get('transfer_window')).toBe('2:100');
	second.previous?.();
	expect(route.href).toBe(firstUrl);
	const restoredFirst = await settle();
	expect(restoredFirst.pageSize).toBe(Number(size));
	restoredFirst.next?.();
	const restoredNext = await settle();
	expect(restoredNext.pageSize).toBe(Number(size));
	const newSize = size === '100' ? '25' : '100';
	restoredNext.changePageSize(newSize);
	expect(route.searchParams.has('transfer_after')).toBe(false);
	expect(route.searchParams.has('transfer_window')).toBe(false);
	expect(route.searchParams.has('transfer_bound')).toBe(false);
	const resized = await settle();
	expect(resized.pageSize).toBe(Number(newSize));
	expect(resized.previous).toBeNull();
	resized.next?.();
	const resizedNext = await settle();
	resizedNext.submit({ ...resizedNext.filters, asset: 'USD:' + account });
	expect(route.searchParams.has('transfer_after')).toBe(false);
	expect(route.searchParams.has('transfer_window')).toBe(false);
	expect((await settle()).previous).toBeNull();
	hooks.reset(); route = new URL(secondUrl);
	const direct = await settle();
	expect(direct.pageSize).toBe(Number(size));
	expect(direct.page?.transfers[0]?.id).toBe('second');
	expect(request.mock.calls.at(-1)?.[0]).toContain('limit=' + size);
	expect(direct.next).toBeNull();
});

it('rejects unsupported/duplicate sizes without querying and keeps explicit cancellation without a local deadline', async () => {
	for (const value of ['10', '101', '1e2', '25&limit=50']) {
		route = new URL(start + '&transfer_query=1&limit=' + value, base);
		expect((await settle()).error).toMatch(/Invalid transfer link/);
	}
	expect(request).not.toHaveBeenCalled();
	route = new URL(start + '&transfer_query=1&limit=100', base);
	request.mockImplementationOnce((_path, signal) => new Promise((_resolve, reject) => {
		signal?.addEventListener('abort', () => reject(new Error('Canceled')), { once: true });
	}));
	const timer = jest.spyOn(globalThis, 'setTimeout');
	try {
		const pending = render();
		expect(pending.busy).toBe(true);
		expect(timer).not.toHaveBeenCalled();
		pending.cancel();
		expect((await settle()).error).toBe('Transfer request canceled.');
		expect(request).toHaveBeenCalledTimes(1);
	} finally { timer.mockRestore(); }
});

it('does not query a malformed link or replace a failed continuation with an empty page', async () => {
	route = new URL(start + '&transfer_after=bad%2Fcursor',base);
	expect((await settle()).error).toMatch(/Invalid transfer link/);
	expect(request).not.toHaveBeenCalled();
	route = new URL(start + '&transfer_query=1&transfer_after=unbounded',base);
	unavailable = true;
	const failed = await settle(), failedUrl = route.href;
	expect(failed.error).toMatch(/503/);
	expect(failed.page).toBeNull();
	failed.retry?.();
	expect((await settle()).error).toMatch(/503/);
	expect(route.href).toBe(failedUrl);
	expect(params(0).toString()).toBe(params(1).toString());
});
