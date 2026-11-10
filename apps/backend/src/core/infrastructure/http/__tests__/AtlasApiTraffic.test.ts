import express from 'express';
import request from 'supertest';
import { createAtlasApiTraffic } from '../AtlasApiTraffic.js';

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
