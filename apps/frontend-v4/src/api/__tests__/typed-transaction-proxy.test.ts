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
		expect(result.headers.get('content-type')).toBe('application/json; charset=utf-8');
		expect(result.headers.get('x-content-type-options')).toBe('nosniff');
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

	it.each([
		new Headers({ 'content-type': 'text/html' }),
		new Headers({ 'content-type': 'application/json', 'content-length': '16777217' })
	])('rejects unsafe response headers and cancels the upstream body: %j', async headers => {
		const cancel = jest.fn<() => void>();
		const body = new ReadableStream<Uint8Array>({ cancel });
		globalThis.fetch = jest.fn<typeof fetch>().mockResolvedValue(new Response(body, { headers }));
		const result = await GET(new Request(path + '?' + query), context);
		expect(result.status).toBe(502);
		expect(result.headers.get('content-type')).toMatch(/^application\/json/);
		expect(result.headers.get('x-content-type-options')).toBe('nosniff');
		expect(cancel).toHaveBeenCalledTimes(1);
	});

	it('cuts off an underdeclared streamed body at the actual byte cap', async () => {
		const cancel = jest.fn<() => void>();
		const chunk = new Uint8Array(1024 * 1024);
		const body = new ReadableStream<Uint8Array>({ pull(stream) { stream.enqueue(chunk); }, cancel });
		globalThis.fetch = jest.fn<typeof fetch>().mockResolvedValue(new Response(body, {
			headers: { 'content-type': 'application/json', 'content-length': '1' }
		}));
		const result = await GET(new Request(path + '?' + query), context);
		const reader = result.body!.getReader();
		for (let i = 0; i < 16; i++) expect((await reader.read()).value?.byteLength).toBe(chunk.length);
		await expect(reader.read()).rejects.toThrow('explorer size limit');
		expect(cancel).toHaveBeenCalledTimes(1);
	});

	it.each(['deadline', 'caller', 'consumer'] as const)('cancels an incomplete body on %s after headers', async reason => {
		const caller = new AbortController();
		const cancel = jest.fn<() => void>();
		const body = new ReadableStream<Uint8Array>({ cancel });
		globalThis.fetch = jest.fn<typeof fetch>().mockResolvedValue(new Response(body, {
			headers: { 'content-type': 'application/json' }
		}));
		const result = await GET(new Request(path + '?' + query, { signal: caller.signal }), context);
		const reader = result.body!.getReader();
		const read = reader.read();
		if (reason === 'consumer') {
			await reader.cancel();
			expect(await read).toMatchObject({ done: true });
		} else {
			const rejected = expect(read).rejects.toBeDefined();
			if (reason === 'caller') caller.abort();
			else await jest.advanceTimersByTimeAsync(65_000);
			await rejected;
		}
		expect(cancel).toHaveBeenCalledTimes(1);
	});
});
