import { jest } from '@jest/globals';
import { GET } from '../../app/api/explorer/account-balances/[account]/route';

const account = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const query = '?limit=25&after=opaque_cursor';
const path = 'https://explorer.invalid/api/explorer/account-balances/' + account;
const context = { params: Promise.resolve({ account }) };
const originalFetch = globalThis.fetch;

afterEach(() => { globalThis.fetch = originalFetch; jest.restoreAllMocks(); });

it('forwards only the bounded wallet page and composes the existing 65-second proxy and caller abort', async () => {
	const timeout = jest.spyOn(AbortSignal, 'timeout');
	const caller = new AbortController();
	const upstream = jest.fn<typeof fetch>().mockResolvedValue(Response.json({ account, balances: [] }));
	globalThis.fetch = upstream;
	const response = await GET(new Request(path + query, { signal: caller.signal }), context);
	expect(response.status).toBe(200);
	expect(await response.json()).toEqual({ account, balances: [] });
	expect(timeout).toHaveBeenCalledWith(65_000);
	expect(upstream).toHaveBeenCalledTimes(1);
	expect(String(upstream.mock.calls[0]?.[0])).toContain('/v1/analytics/accounts/' + account + '/balances' + query);
	expect(upstream.mock.calls[0]?.[1]).toMatchObject({ cache: 'no-store', redirect: 'error' });
	caller.abort();
	expect(upstream.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
});

it('rejects invalid account, excessive cursors and query widening without upstream traffic', async () => {
	const upstream = jest.fn<typeof fetch>();
	globalThis.fetch = upstream;
	for (const bad of ['?limit=200', '?limit=25&limit=25', '?limit=25&min_ledger=1', '?limit=25&after=' + 'a'.repeat(513)]) {
		expect((await GET(new Request(path + bad), context)).status).toBe(400);
	}
	expect((await GET(new Request(path + query), { params: Promise.resolve({ account: account.slice(0, -1) + 'A' }) })).status).toBe(400);
	expect(upstream).not.toHaveBeenCalled();
});
