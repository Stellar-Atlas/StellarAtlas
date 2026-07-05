import express from 'express';
import request from 'supertest';
import { blockchainExplorerRouter } from '../BlockchainExplorerRouter.js';

const createApp = () => {
	const app = express();
	app.use(
		'/v1/explorer',
		blockchainExplorerRouter({
			horizonUrl: 'https://horizon.example'
		})
	);
	return app;
};

describe('BlockchainExplorerRouter.integration', () => {
	const contractId = `C${'A'.repeat(55)}`;

	afterEach(() => {
		jest.restoreAllMocks();
	});

	it('returns a Horizon-backed ledger search result', async () => {
		jest.spyOn(global, 'fetch').mockResolvedValue(
			new Response(
				JSON.stringify({
					closed_at: '2026-07-05T05:11:31Z',
					hash: 'ledger-hash',
					operation_count: 623,
					protocol_version: 26,
					sequence: 63335066
				}),
				{ status: 200 }
			)
		);

		await request(createApp())
			.get('/v1/explorer/search?query=63335066&type=ledger')
			.expect(200)
			.expect('Cache-Control', 'public, max-age=20')
			.expect((response) => {
				expect(response.body).toMatchObject({
					query: '63335066',
					resultType: 'ledger',
					source: 'horizon',
					result: {
						operationCount: 623,
						sequence: '63335066',
						source: 'horizon'
					}
				});
			});
	});

	it('rejects invalid account operation filters before Horizon lookup', async () => {
		const fetchSpy = jest.spyOn(global, 'fetch');

		await request(createApp())
			.get('/v1/explorer/operations?accountId=not-an-account')
			.expect(400)
			.expect((response) => {
				expect(response.body).toEqual({ error: 'Invalid operation filters' });
			});

		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('returns a bounded recent transaction feed', async () => {
		jest.spyOn(global, 'fetch').mockResolvedValue(
			new Response(
				JSON.stringify({
					_embedded: {
						records: [
							{
								created_at: '2026-07-05T05:11:31Z',
								fee_charged: '100',
								hash: 'a'.repeat(64),
								ledger: 63335066,
								operation_count: 3,
								source_account: `G${'A'.repeat(55)}`,
								successful: true
							}
						]
					},
					_links: {
						next: {
							href: 'https://horizon.example/transactions?cursor=next'
						}
					}
				}),
				{ status: 200 }
			)
		);

		await request(createApp())
			.get('/v1/explorer/transactions?limit=10')
			.expect(200)
			.expect((response) => {
				expect(response.body).toMatchObject({
					limit: 10,
					source: 'horizon',
					truncated: true,
					records: [
						{
							hash: 'a'.repeat(64),
							ledger: '63335066',
							source: 'horizon'
						}
					]
				});
			});
	});

	it('rejects unbounded transaction feed limits', async () => {
		const fetchSpy = jest.spyOn(global, 'fetch');

		await request(createApp())
			.get('/v1/explorer/transactions?limit=500')
			.expect(400)
			.expect((response) => {
				expect(response.body).toEqual({ error: 'Invalid transaction limit' });
			});

		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('reports contract lookup as unconfigured until RPC is wired', async () => {
		await request(createApp())
			.get(`/v1/explorer/contracts/${contractId}`)
			.expect(200)
			.expect((response) => {
				expect(response.body).toMatchObject({
					source: 'rpc',
					status: 'unconfigured'
				});
			});
	});
});
