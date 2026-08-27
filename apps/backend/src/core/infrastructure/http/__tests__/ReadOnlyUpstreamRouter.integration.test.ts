import express from 'express';
import request from 'supertest';
import { createServer, type Server } from 'node:http';
import { readOnlyUpstreamRouter } from '../ReadOnlyUpstreamRouter.js';

describe('ReadOnlyUpstreamRouter.integration', () => {
	let upstream: Server;
	let targetBaseUrl: string;
	let observedUrl: string | null;

	beforeEach(async () => {
		observedUrl = null;
		upstream = createServer((req, res) => {
			observedUrl = req.url ?? null;
			if (req.url?.startsWith('/base/root') === true) {
				const host = req.headers.host ?? 'unknown';
				res.setHeader('Content-Type', 'application/hal+json');
				res.end(
					JSON.stringify({
						_links: { self: { href: 'https://' + host + '/' } }
					})
				);
				return;
			}
			res.statusCode = 206;
			res.setHeader('Accept-Ranges', 'bytes');
			res.setHeader('Content-Range', 'bytes 1-2/4');
			res.setHeader('Content-Type', 'application/octet-stream');
			res.end(Buffer.from('at'));
		});
		await new Promise<void>((resolve) => {
			upstream.listen(0, '127.0.0.1', resolve);
		});
		const address = upstream.address();
		if (address === null || typeof address === 'string') {
			throw new Error('Test upstream did not bind');
		}
		targetBaseUrl = 'http://127.0.0.1:' + address.port + '/base/';
	});

	afterEach(async () => {
		await new Promise<void>((resolve, reject) => {
			upstream.close((error) =>
				error === undefined ? resolve() : reject(error)
			);
		});
	});

	it('rewrites Horizon JSON links under the public prefix', async () => {
		const app = express();
		app.set('trust proxy', true);
		app.use(
			'/horizon',
			readOnlyUpstreamRouter({
				forwardPublicHost: true,
				publicPrefix: '/horizon',
				rewriteJsonLinks: true,
				serviceName: 'Horizon',
				targetBaseUrl
			})
		);

		await request(app)
			.get('/horizon/root?order=desc')
			.set('Host', 'api.stellaratlas.test')
			.set('X-Forwarded-Proto', 'https')
			.expect(200)
			.expect((response) => {
				expect(response.body._links.self.href).toBe(
					'https://api.stellaratlas.test/horizon/'
				);
				expect(observedUrl).toBe('/base/root?order=desc');
			});
	});

	it('streams binary and range headers without buffering', async () => {
		const app = express();
		app.use(
			'/galexie',
			readOnlyUpstreamRouter({
				publicPrefix: '/galexie',
				serviceName: 'Galexie',
				targetBaseUrl
			})
		);

		await request(app)
			.get('/galexie/object.xdr.zst')
			.set('Range', 'bytes=1-2')
			.expect(206)
			.expect('Content-Range', 'bytes 1-2/4')
			.expect((response) => {
				expect(observedUrl).toBe('/base/object.xdr.zst');
			});
	});

	it('rejects state-changing methods', async () => {
		const app = express();
		app.use(
			'/horizon',
			readOnlyUpstreamRouter({
				publicPrefix: '/horizon',
				serviceName: 'Horizon',
				targetBaseUrl
			})
		);
		await request(app).post('/horizon/transactions').expect(405);
		expect(observedUrl).toBeNull();
	});
});
