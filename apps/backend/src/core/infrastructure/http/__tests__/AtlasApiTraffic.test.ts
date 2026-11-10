import express from 'express';
import request from 'supertest';
import { createAtlasApiTraffic } from '../AtlasApiTraffic.js';
import { createAtlasApiEventSender } from '../AtlasApiEventSender.js';

it('counts all observed HTTP outcomes in bounded labels, including early failures and aborted requests', async () => {
	const lines: string[] = [];
	const sink = {
		destroyed: false, writableNeedDrain: true,
		write: (value: unknown) => { lines.push(String(value)); return true; }
	};
	const traffic = createAtlasApiTraffic({ paths: {
		'/v1/accounts/{account}': { get: {} },
		'/v1/accounts/lookup': { get: {} },
		'/v1/preflight': { options: {} },
		'/graphql': { post: {} }
	} }, sink);
	const api = express();
	api.use(traffic.observe);
	api.use(express.json());
	api.use((req, _res, next) => { next(req.path === '/early-error' ? new Error('fixture') : undefined); });
	api.options('/v1/preflight', (_req, res) => { res.status(204).end(); });
	api.get('/v1/accounts/lookup', (_req, res) => { res.status(429).end(); });
	api.get('/v1/accounts/:account', (_req, res) => { res.status(200).end(); });
	api.post('/graphql', (_req, res) => { res.status(503).end(); });
	api.get('/disconnect', (_req, res) => { res.destroy(); });
	api.use((_error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
		res.status(_error instanceof SyntaxError ? 400 : 500).end();
	});
	await request(api).get('/v1/accounts/private-address?token=private-token').expect(200);
	await request(api).get('/v1/accounts/lookup').expect(429);
	await request(api).post('/graphql').send({ query: 'private query' }).expect(503);
	await request(api).get('/not-a-public-route').expect(404);
	await request(api).options('/v1/preflight').expect(204);
	await request(api).trace('/not-a-public-route').expect(404);
	await request(api).get('/' + 'x'.repeat(2200)).expect(404);
	await request(api).get('/' + Array(18).fill('private').join('/')).expect(404);
	await request(api).get('/early-error').expect(500);
	await request(api).post('/bad-json').set('Content-Type', 'application/json').send('{').expect(400);
	await expect(request(api).get('/disconnect')).rejects.toThrow();
	const warehouse = traffic.handshake('/v1/stream/data');
	warehouse('attempted');
	warehouse('rejected');
	traffic.flush();
	expect(lines).toEqual([]);
	sink.writableNeedDrain = false;
	traffic.flush();
	expect(lines).toHaveLength(1);
	const summary = JSON.parse(lines[0]!);
	expect(summary).toMatchObject({
		type: 'atlas_public_api_traffic_v1', deferredFlushes: 1, httpScope: 'all_express_requests',
		http: {
			'GET /v1/accounts/{account}': { '2xx': 1 },
			'GET /v1/accounts/lookup': { '429': 1 },
			'POST /graphql': { '5xx': 1 },
			'OPTIONS /v1/preflight': { '2xx': 1 },
			UNMATCHED_ROUTE: { '4xx': 2, '5xx': 1, aborted: 1 },
			UNSUPPORTED_METHOD: { '4xx': 1 },
			INVALID_PATH: { '4xx': 2 }
		},
		websocket: { '/v1/stream/data': { attempted: 1, accepted: 0, rejected: 1 } }
	});
	expect(Object.keys(summary.http)).toHaveLength(7);
	expect(lines[0]).not.toMatch(/private|not-a-public-route/);
	traffic.flush();
	expect(lines).toHaveLength(1);
});

it('delivers API custom events asynchronously without forwarding identities or inflating pageviews', async () => {
	let release!: () => void;
	const held = new Promise<void>(resolve => { release = resolve; });
	const payloads: unknown[] = [];
	const send = jest.fn<typeof fetch>().mockImplementation(async (url, options) => {
		expect(url).toBe('http://127.0.0.1:18080/api/event');
		expect(options?.headers).toEqual({ 'Content-Type': 'application/json', 'User-Agent': 'StellarAtlasAPIEvents/1.0' });
		payloads.push(JSON.parse(String(options?.body)));
		await held;
		return new Response(null, { status: 202 });
	});
	const events = createAtlasApiEventSender({ ATLAS_API_PLAUSIBLE_ORIGIN: 'http://127.0.0.1:18080' }, send)!;
	const lines: string[] = [];
	const traffic = createAtlasApiTraffic({ paths: { '/v1/accounts/{account}': { get: {} } } }, {
		destroyed: false, writableNeedDrain: false, write: value => { lines.push(String(value)); return true; }
	}, events);
	const api = express();
	api.use(traffic.observe);
	api.get('/v1/accounts/:account', (_req, res) => { res.status(200).end(); });
	try {
		await request(api).get('/v1/accounts/private-wallet?key=private').set('User-Agent', 'private-agent')
			.set('X-Forwarded-For', '192.0.2.99').expect(200);
		await new Promise<void>(resolve => setImmediate(resolve));
		expect(events.snapshot()).toMatchObject({ accepted: 0, active: 1 });
		expect(payloads).toEqual([{ name: 'API request', domain: 'api.stellaratlas.io',
			url: 'https://api.stellaratlas.io/requests', interactive: false,
			props: { route: '/v1/accounts/{account}', method: 'GET', outcome: '2xx', scope: 'origin_http' } }]);
		expect(JSON.stringify(payloads)).not.toMatch(/private|192\.0\.2\.99|pageview/);
		await request(api).get('/private-unknown-route').expect(404);
	} finally {
		release();
		await traffic.close();
	}
	const summary = JSON.parse(lines.at(-1)!);
	expect(summary.plausibleDelivery).toMatchObject({ semantics: 'process_cumulative', enqueued: 2,
		accepted: 2, failed: 0, pending: 0, active: 0 });
	expect(payloads.at(-1)).toMatchObject({ props: { route: 'UNMATCHED_ROUTE', method: 'GET', outcome: '4xx' } });
});

it('bounds the API event queue and retries only a connection refusal, not ambiguous or dropped events', async () => {
	const options = { ATLAS_API_PLAUSIBLE_ORIGIN: 'http://127.0.0.1:18080' };
	expect(createAtlasApiEventSender({})).toBeUndefined();
	expect(() => createAtlasApiEventSender({ ATLAS_API_PLAUSIBLE_ORIGIN: 'https://analytics.example' })).toThrow();
	const ready = jest.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 202 }));
	const bounded = createAtlasApiEventSender(options, ready)!;
	for (let index = 0; index < 1026; index++) bounded.record('UNMATCHED_ROUTE', '4xx');
	expect(ready).not.toHaveBeenCalled();
	expect(bounded.snapshot()).toMatchObject({ enqueued: 1024, pending: 1024, overloaded: 2 });
	await bounded.close();
	expect(bounded.snapshot()).toMatchObject({ accepted: 1024, active: 0, pending: 0 });

	const refused = new TypeError('not logged', { cause: { code: 'ECONNREFUSED' } });
	const retry = jest.fn<typeof fetch>().mockRejectedValueOnce(refused).mockResolvedValue(new Response(null, { status: 202 }));
	const retried = createAtlasApiEventSender(options, retry)!;
	retried.record('POST /graphql', '2xx');
	await retried.close();
	expect(retry).toHaveBeenCalledTimes(2);
	expect(retried.snapshot()).toMatchObject({ accepted: 1, retried: 1, failed: 0 });

	for (const [response, expected] of [
		[new Response(null, { status: 202, headers: { 'x-plausible-dropped': '1' } }), { collectorDropped: 1 }],
		[new Response(null, { status: 429 }), { rejected: 1 }],
		[new Error('ambiguous timeout; must not retry'), { ambiguous: 1 }]
	] as const) {
		const send = jest.fn<typeof fetch>().mockImplementation(async () => {
			if (response instanceof Error) throw response;
			return response;
		});
		const failed = createAtlasApiEventSender(options, send)!;
		failed.record('INVALID_PATH', 'aborted');
		await failed.close();
		expect(send).toHaveBeenCalledTimes(1);
		expect(failed.snapshot()).toMatchObject({ failed: 1, accepted: 0, ...expected });
	}
});
