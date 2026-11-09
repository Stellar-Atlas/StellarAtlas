import express from 'express';
import request from 'supertest';
import { createAtlasApiTraffic } from '../AtlasApiTraffic.js';

it('counts documented request outcomes without retaining request identifiers, even with a blocked sink', async () => {
	const lines: string[] = [];
	const sink = {
		destroyed: false, writableNeedDrain: true,
		write: (value: unknown) => { lines.push(String(value)); return true; }
	};
	const traffic = createAtlasApiTraffic({ paths: {
		'/v1/accounts/{account}': { get: {} },
		'/v1/accounts/lookup': { get: {} },
		'/graphql': { post: {} }
	} }, sink);
	const api = express();
	api.use(traffic.observe);
	api.get('/v1/accounts/lookup', (_req, res) => { res.status(429).end(); });
	api.get('/v1/accounts/:account', (_req, res) => { res.status(200).end(); });
	api.post('/graphql', (_req, res) => { res.status(503).end(); });
	await request(api).get('/v1/accounts/private-address?token=private-token').expect(200);
	await request(api).get('/v1/accounts/lookup').expect(429);
	await request(api).post('/graphql').send({ query: 'private query' }).expect(503);
	await request(api).get('/not-a-public-route').expect(404);
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
		type: 'atlas_public_api_traffic_v1', deferredFlushes: 1,
		http: {
			'GET /v1/accounts/{account}': { '2xx': 1 },
			'GET /v1/accounts/lookup': { '429': 1 },
			'POST /graphql': { '5xx': 1 }
		},
		websocket: { '/v1/stream/data': { attempted: 1, accepted: 0, rejected: 1 } }
	});
	expect(Object.keys(summary.http)).toHaveLength(3);
	expect(lines[0]).not.toMatch(/private|not-a-public-route/);
	traffic.flush();
	expect(lines).toHaveLength(1);
});
