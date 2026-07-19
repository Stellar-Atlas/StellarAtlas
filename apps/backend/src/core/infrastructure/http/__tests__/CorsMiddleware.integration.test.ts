import express from 'express';
import request from 'supertest';
import { corsMiddleware } from '../CorsMiddleware.js';

describe('CorsMiddleware', () => {
	it('exposes the public inventory scope header', async () => {
		const app = express();
		app.use(corsMiddleware);
		app.get('/inventory', (_req, res) => {
			res.setHeader('X-StellarAtlas-Inventory-Scope', 'current-network');
			res.sendStatus(204);
		});

		await request(app)
			.get('/inventory')
			.expect(204)
			.expect('Access-Control-Allow-Origin', '*')
			.expect('Access-Control-Expose-Headers', 'X-StellarAtlas-Inventory-Scope')
			.expect('X-StellarAtlas-Inventory-Scope', 'current-network');
	});
});
