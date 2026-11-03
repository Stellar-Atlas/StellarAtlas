import { jest } from '@jest/globals';
import { GET } from '../../app/api/explorer/typed-transactions/[hash]/route';

const hash = 'a'.repeat(64);
const query = 'view=typed&limit=20&ledger_sequence=64987266&events_after=next_page';
const path = 'https://explorer.invalid/api/explorer/typed-transactions/' + hash;
const context = { params: Promise.resolve({ hash }) };
const originalFetch = globalThis.fetch;

describe('typed transaction proxy', () => {
	beforeEach(() => {
		jest.useFakeTimers();
		jest.spyOn(AbortSignal, 'timeout').mockImplementation(ms => {
			const timeout = new AbortController();
			setTimeout(() => timeout.abort(), ms);
			return timeout.signal;
		});
	});
	afterEach(() => {
		globalThis.fetch = originalFetch;
		jest.restoreAllMocks();
		jest.useRealTimers();
	});

	it('allows a 61-second response without changing ledger, cursor or page size', async () => {
		const upstream = jest.fn<typeof fetch>().mockImplementation(() => new Promise(resolve => {
			setTimeout(() => resolve(Response.json({ transaction: { hash } })), 61_000);
		}));
		globalThis.fetch = upstream;
		const pending = GET(new Request(path + '?' + query), context);
		await jest.advanceTimersByTimeAsync(61_000);
		const result = await pending;
		expect(upstream).toHaveBeenCalledTimes(1);
		expect(upstream.mock.calls[0]?.[0]).toEqual(expect.stringMatching(
			'/v1/analytics/transactions/' + hash + '\\?' + query
		));
		expect(upstream.mock.calls[0]?.[1]).toMatchObject({ cache: 'no-store', redirect: 'error' });
		expect(upstream.mock.calls[0]?.[1]?.signal?.aborted).toBe(false);
		expect(result.status).toBe(200);
		expect(result.headers.get('cache-control')).toBe('no-store');
		expect(await result.json()).toEqual({ transaction: { hash } });
	});

	it.each(['deadline', 'caller'] as const)('propagates %s cancellation without retrying', async reason => {
		const caller = new AbortController();
		const upstream = jest.fn<typeof fetch>().mockImplementation((_url, options) => new Promise((_resolve, reject) => {
			options?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
		}));
		globalThis.fetch = upstream;
		const pending = GET(new Request(path + '?' + query, { signal: caller.signal }), context);
		await jest.advanceTimersByTimeAsync(64_999);
		expect(upstream.mock.calls[0]?.[1]?.signal?.aborted).toBe(false);
		if (reason === 'caller') caller.abort();
		else await jest.advanceTimersByTimeAsync(1);
		const result = await pending;
		expect(result.status).toBe(reason === 'caller' ? 502 : 504);
		expect(upstream.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
		expect(upstream).toHaveBeenCalledTimes(1);
	});

	it('passes through an actual upstream 503 and rejects ambiguous or widened requests locally', async () => {
		const upstream = jest.fn<typeof fetch>().mockResolvedValue(Response.json({ error: 'Unavailable' }, { status: 503 }));
		globalThis.fetch = upstream;
		const result = await GET(new Request(path + '?' + query), context);
		expect(result.status).toBe(503);
		expect(await result.json()).toEqual({ error: 'Unavailable' });
		for (const invalid of [query + '&ledger_sequence=1', query.replace('limit=20', 'limit=200'), query + '&url=https://example.invalid']) {
			expect((await GET(new Request(path + '?' + invalid), context)).status).toBe(400);
		}
		expect((await GET(new Request(path + '?' + query, { method: 'HEAD' }), context)).status).toBe(405);
		expect(upstream).toHaveBeenCalledTimes(1);
	});
});
