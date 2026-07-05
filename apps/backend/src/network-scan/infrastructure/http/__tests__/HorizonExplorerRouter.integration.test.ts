import express from 'express';
import request from 'supertest';
import { horizonExplorerRouter } from '../HorizonExplorerRouter.js';
import type { HorizonExplorerRouterConfig } from '../HorizonExplorerRouter.js';

const transactionHash = `${'a'.repeat(64)}`;

const createApp = (config: Partial<HorizonExplorerRouterConfig> = {}) => {
	const app = express();
	app.use(
		'/v1',
		horizonExplorerRouter({
			horizonUrl: 'https://horizon.example',
			...config
		})
	);
	return app;
};

describe('HorizonExplorerRouter.integration', () => {
	it('returns a Horizon-sourced transaction lookup', async () => {
		const fetchTransaction = jest.fn().mockResolvedValue({
			createdAt: '2026-07-05T00:00:00Z',
			feeCharged: '100',
			hash: transactionHash,
			ledger: '63333001',
			operationCount: 2,
			source: 'horizon',
			sourceAccount: 'GA_SOURCE',
			successful: true
		});

		await request(createApp({ fetchTransaction }))
			.get(`/v1/transactions/${transactionHash.toUpperCase()}`)
			.expect(200)
			.expect('Cache-Control', 'public, max-age=30')
			.expect((response) => {
				expect(response.body).toMatchObject({
					hash: transactionHash,
					ledger: '63333001',
					source: 'horizon'
				});
			});

		expect(fetchTransaction).toHaveBeenCalledWith(
			'https://horizon.example',
			transactionHash
		);
	});

	it('rejects invalid transaction hashes before Horizon lookup', async () => {
		const fetchTransaction = jest.fn();

		await request(createApp({ fetchTransaction }))
			.get('/v1/transactions/not-a-hash')
			.expect(400)
			.expect((response) => {
				expect(response.body).toEqual({ error: 'Invalid transaction hash' });
			});

		expect(fetchTransaction).not.toHaveBeenCalled();
	});

	it('returns not found when configured Horizon has no transaction', async () => {
		const fetchTransaction = jest.fn().mockResolvedValue(null);

		await request(createApp({ fetchTransaction }))
			.get(`/v1/transactions/${transactionHash}`)
			.expect(404)
			.expect((response) => {
				expect(response.body).toEqual({
					error: 'Transaction not found in configured Horizon'
				});
			});
	});

	it('returns unavailable when Horizon lookup fails', async () => {
		const fetchTransaction = jest.fn().mockRejectedValue(new Error('down'));

		await request(createApp({ fetchTransaction }))
			.get(`/v1/transactions/${transactionHash}`)
			.expect(502)
			.expect((response) => {
				expect(response.body).toEqual({
					error: 'Transaction lookup unavailable'
				});
			});
	});
});
