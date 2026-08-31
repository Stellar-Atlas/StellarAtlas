import express from 'express';
import request from 'supertest';
import { createServer, type Server } from 'node:http';
import {
	stellarRpcRouter,
	unavailableStellarRpcRouter
} from '../StellarRpcRouter.js';

describe('StellarRpcRouter.integration', () => {
	let upstream: Server;
	let targetUrl: string;
	let observedBody: unknown;
	let observedRequests: number;

	beforeEach(async () => {
		observedBody = null;
		observedRequests = 0;
		upstream = createServer((req, res) => {
			observedRequests += 1;
			const chunks: Buffer[] = [];
			req.on('data', (chunk: Buffer) => chunks.push(chunk));
			req.on('end', () => {
				observedBody = JSON.parse(Buffer.concat(chunks).toString('utf8'));
				res.setHeader('Content-Type', 'application/json');
				res.end(
					JSON.stringify({
						id: 7,
						jsonrpc: '2.0',
						result: { status: 'healthy' }
					})
				);
			});
		});
		await new Promise<void>((resolve) => {
			upstream.listen(0, '127.0.0.1', resolve);
		});
		const address = upstream.address();
		if (address === null || typeof address === 'string') {
			throw new Error('Test upstream did not bind');
		}
		targetUrl = 'http://127.0.0.1:' + address.port;
	});

	afterEach(async () => {
		await new Promise<void>((resolve, reject) => {
			upstream.close((error) =>
				error === undefined ? resolve() : reject(error)
			);
		});
	});

	it('forwards a JSON-RPC request to the fixed upstream', async () => {
		const app = express();
		app.use(express.json({ limit: '2mb' }));
		app.use('/rpc', stellarRpcRouter({ targetUrl }));

		await request(app)
			.post('/rpc')
			.send({ id: 7, jsonrpc: '2.0', method: 'getHealth' })
			.expect(200)
			.expect('Content-Type', /json/)
			.expect(({ body }) => {
				expect(body.result.status).toBe('healthy');
			});
		expect(observedBody).toEqual({
			id: 7,
			jsonrpc: '2.0',
			method: 'getHealth'
		});
	});

	it('rejects non-POST and non-object requests without touching upstream', async () => {
		const app = express();
		app.use(express.json({ limit: '2mb', strict: false }));
		app.use('/rpc', stellarRpcRouter({ targetUrl }));

		await request(app).get('/rpc').expect(405).expect('Allow', 'POST');
		await request(app)
			.post('/rpc')
			.set('Content-Type', 'application/json')
			.send('null')
			.expect(400);
		expect(observedRequests).toBe(0);
	});

	it('reports an unavailable configuration explicitly', async () => {
		const app = express();
		app.use('/rpc', unavailableStellarRpcRouter());

		await request(app)
			.post('/rpc')
			.expect(503)
			.expect('Retry-After', '60')
			.expect({ error: 'Stellar RPC is not configured' });
	});
});
