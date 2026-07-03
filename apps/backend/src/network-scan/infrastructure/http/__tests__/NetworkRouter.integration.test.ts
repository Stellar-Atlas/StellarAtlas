import express from 'express';
import request from 'supertest';
import { mockDeep } from 'jest-mock-extended';
import { ok } from 'neverthrow';
import { networkRouter } from '../NetworkRouter.js';
import type { NetworkRouterConfig } from '../NetworkRouter.js';

describe('NetworkRouter.integration', () => {
	it('should expose current network snapshots with frontend-aligned cache age', async () => {
		const config = mockDeep<NetworkRouterConfig>();
		config.getNetwork.execute.mockResolvedValue(
			ok({
				name: 'Public Stellar Network'
			} as never)
		);

		const app = express();
		app.use('/network', networkRouter(config));

		await request(app)
			.get('/network')
			.expect(200)
			.expect('Cache-Control', 'public, max-age=10')
			.expect((response) => {
				expect(response.body.name).toBe('Public Stellar Network');
			});
	});
});
