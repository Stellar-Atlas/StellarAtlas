import express from 'express';
import request from 'supertest';
import { isArchiveRadarResponse } from 'shared';
import { archiveRadarObservationRouter } from '../ArchiveRadarObservationRouter.js';
import type { RadarHistoryArchiveScanFetch } from '@cross-check/infrastructure/radar/RadarHistoryArchiveScanSourceAdapter.js';

const root = 'https://history.example.com/History';
const path = (url = root): string => `/v2/archive-scans/${encodeURIComponent(url)}/radar-observation`;
const scan = (url = root): Response => new Response(JSON.stringify({ url, startDate: '2026-01-01T00:00:00Z', endDate: '2026-01-01T00:01:00Z', hasError: true, errorUrl: root + '/ledger.xdr.gz', errorMessage: 'Unpublished diagnostic' }));
function app(fetchFn: RadarHistoryArchiveScanFetch, now?: () => Date): express.Express {
	const value = express(); value.use('/v2/archive-scans', archiveRadarObservationRouter({ fetchFn, now })); return value;
}
const tick = (): Promise<void> => new Promise(resolve => setImmediate(resolve));

describe('explicit per-root Radar route', () => {
	it('rejects methods and invalid/oversized/query roots without upstream work', async () => {
		let calls = 0; const server = app(async () => { calls++; return scan(); });
		await request(server).head(path()).expect(405).expect('Allow', 'GET').expect('Cache-Control', 'no-store');
		await request(server).post(path()).expect(405);
		await request(server).put(path()).expect(405);
		await request(server).options(path()).expect(405);
		for (const unsafe of ['https://user:password@history.example.com', 'ftp://history.example.com', root + '?token=x', root + '#x', root + '/' + 'x'.repeat(2048)]) {
			const response = await request(server).get(path(unsafe)).expect(400); expect(isArchiveRadarResponse(response.body)).toBe(true); expect(response.body.archiveUrl).toBeNull();
		}
		await request(server).get(path() + '?unexpected=x').expect(400);
		await request(server).get(path() + '?x=1&x=2').expect(400);
		expect(calls).toBe(0);
	});
	it('returns sanitized root-bound observations, canonical aliases, and original cached times', async () => {
		let calls = 0, time = Date.parse('2026-02-01T00:00:00Z');
		const server = app(async () => { calls++; return scan(); }, () => new Date(time));
		const first = await request(server).get(path('https://HISTORY.EXAMPLE.COM:443/History/.well-known/stellar-history.json')).expect(200).expect('Cache-Control', 'no-store');
		expect(isArchiveRadarResponse(first.body)).toBe(true); expect(first.body.archiveUrl).toBe(root);
		expect(JSON.stringify(first.body)).not.toMatch(/Unpublished diagnostic|endpointUrl/);
		time += 1000;
		const second = await request(server).get(path()).expect(200);
		expect(second.body.cached).toBe(true); expect(second.body.lookupAt).toBe(first.body.lookupAt);
		expect(second.body.observation).toEqual(first.body.observation); expect(second.body.servedAt).not.toBe(first.body.servedAt); expect(calls).toBe(1);
		expect(isArchiveRadarResponse({ ...second.body, extra: true })).toBe(false);
		expect(isArchiveRadarResponse({ ...second.body, errorCode: 'upstream_timeout' })).toBe(false);
	});
	it.each([404, 500] as const)('preserves original null-observation lookup and fixed status/code on cached %s', async status => {
		let calls = 0, time = Date.parse('2026-02-01T00:00:00Z'), cancelled = 0;
		const server = app(async () => { calls++; return new Response(new ReadableStream({ cancel() { cancelled++; } }), { status }); }, () => new Date(time));
		const first = await request(server).get(path()).expect(status === 404 ? 200 : 502);
		time += 1000;
		const cached = await request(server).get(path()).expect(first.status);
		expect(first.body.observation).toBeNull(); expect(cached.body.lookupAt).toBe(first.body.lookupAt); expect(cached.body.errorCode).toBe(first.body.errorCode); expect(cached.body.status).toBe(first.body.status); expect(cached.body.cached).toBe(true);
		expect(isArchiveRadarResponse(cached.body)).toBe(true); expect(calls).toBe(1); expect(cancelled).toBe(1);
		time += status === 404 ? 30_000 : 5000;
		await request(server).get(path()); expect(calls).toBe(2);
	});
	it('rejects redirects, foreign roots and oversized bodies with fixed safe errors', async () => {
		for (const response of [new Response('redirect', { status: 302, headers: { location: 'https://other.example' } }), scan('https://other.example'), new Response('x'.repeat(100_001))]) {
			const result = await request(app(async (_url, init) => { expect(init?.redirect).toBe('manual'); return response; })).get(path()).expect(502);
			expect(result.body.status).toBe('unavailable'); expect(isArchiveRadarResponse(result.body)).toBe(true);
		}
	});
	it('enforces finite LRU entries rather than retaining all requested roots', async () => {
		let calls = 0;
		const server = app(async input => { calls++; return scan(decodeURIComponent(String(input).split('/history-scan/')[1] ?? '')); });
		for (let index = 0; index < 33; index++) await request(server).get(path(`https://history.example.com/Root${index}`)).expect(200);
		await request(server).get(path('https://history.example.com/Root32')).expect(200); expect(calls).toBe(33);
		await request(server).get(path('https://history.example.com/Root0')).expect(200); expect(calls).toBe(34);
	});
	it('admits no joined waiters and holds admission through cancellation cleanup', async () => {
		let release: (() => void) | undefined, started: (() => void) | undefined, cleaning: (() => void) | undefined, calls = 0;
		const began = new Promise<void>(resolve => { started = resolve; });
		const cleanupStarted = new Promise<void>(resolve => { cleaning = resolve; });
		const cleanup = new Promise<void>(resolve => { release = resolve; });
		const server = app(async () => {
			calls++; if (calls > 1) return scan();
			return new Response(new ReadableStream({ start() { started?.(); }, cancel() { cleaning?.(); return cleanup; } }));
		});
		const listener = server.listen(0, '127.0.0.1');
		const first = request(listener).get(path()); const completion = first.then(() => undefined, () => undefined);
		try {
		await began;
		await request(listener).get(path()).expect(429).expect('Retry-After', '1');
		first.abort(); await cleanupStarted;
		await request(listener).get(path()).expect(429); expect(calls).toBe(1);
		release?.(); await completion; await tick();
		await request(listener).get(path()).expect(200); expect(calls).toBe(2);
		} finally { release?.(); first.abort(); await new Promise<void>(resolve => listener.close(() => resolve())); }
	});
});
