import express from 'express';
import request from 'supertest';
import { StrKey } from '@stellar/stellar-sdk';
import { historyAnalyticsRouter } from '../HistoryAnalyticsRouter.js';

describe('HistoryAnalyticsRouter.integration', () => {
	const issuer = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 7));
	const holder = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 9));

	it('returns current issued-asset holders with explicit coverage', async () => {
		const observed: URL[] = [];
		const fetcher: typeof fetch = async (input) => {
			const url = new URL(
				typeof input === 'string'
					? input
					: input instanceof URL
						? input.toString()
						: input.url
			);
			observed.push(url);
			if (url.pathname === '/accounts') {
				return jsonResponse({
					_embedded: {
						records: [
							{
								account_id: holder,
								balances: [
									{
										asset_code: 'USDC',
										asset_issuer: issuer,
										asset_type: 'credit_alphanum4',
										balance: '125.5000000',
										buying_liabilities: '1.0000000',
										is_authorized: true,
										is_authorized_to_maintain_liabilities: false,
										is_clawback_enabled: false,
										limit: '1000.0000000',
										selling_liabilities: '2.0000000'
									}
								],
								last_modified_ledger: 64_000_001,
								paging_token: '123'
							}
						]
					}
				});
			}
			return jsonResponse({ history_latest_ledger: 64_000_010 });
		};
		const app = buildApp(fetcher);

		await request(app)
			.get(
				'/v1/analytics/assets/holders?asset=' +
					encodeURIComponent('USDC:' + issuer) +
					'&limit=25&order=desc'
			)
			.expect(200)
			.expect('Cache-Control', 'public, max-age=5')
			.expect((response) => {
				expect(response.body).toMatchObject({
					asset: {
						code: 'USDC',
						id: 'USDC:' + issuer,
						issuer,
						type: 'credit_alphanum4'
					},
					coverage: {
						historyLatestLedger: '64000010',
						scope: 'current_state',
						source: 'owned_horizon'
					},
					limit: 25,
					nextCursor: '123',
					order: 'desc',
					records: [
						{
							accountId: holder,
							balance: '125.5000000',
							buyingLiabilities: '1.0000000',
							lastModifiedLedger: '64000001',
							pagingToken: '123',
							sellingLiabilities: '2.0000000'
						}
					]
				});
			});

		const accountsUrl = observed.find(
			({ pathname }) => pathname === '/accounts'
		);
		expect(accountsUrl?.searchParams.get('asset')).toBe('USDC:' + issuer);
		expect(accountsUrl?.searchParams.get('limit')).toBe('25');
		expect(accountsUrl?.searchParams.get('order')).toBe('desc');
	});

	it('reports native holder enumeration as unavailable without calling Horizon', async () => {
		let calls = 0;
		const fetcher: typeof fetch = async () => {
			calls += 1;
			return jsonResponse({});
		};

		await request(buildApp(fetcher))
			.get('/v1/analytics/assets/holders?asset=native')
			.expect(501)
			.expect((response) => {
				expect(response.body.error).toContain('local account-state index');
			});
		expect(calls).toBe(0);
	});

	it('rejects malformed asset identifiers without calling Horizon', async () => {
		let calls = 0;
		const fetcher: typeof fetch = async () => {
			calls += 1;
			return jsonResponse({});
		};

		await request(buildApp(fetcher))
			.get('/v1/analytics/assets/holders?asset=USDC:not-an-account')
			.expect(400);
		expect(calls).toBe(0);
	});
});

function buildApp(fetcher: typeof fetch): express.Application {
	const app = express();
	app.use(
		'/v1/analytics',
		historyAnalyticsRouter({
			fetcher,
			horizonBaseUrl: 'http://horizon.internal/'
		})
	);
	return app;
}

function jsonResponse(value: unknown): Response {
	return new Response(JSON.stringify(value), {
		headers: { 'Content-Type': 'application/json' },
		status: 200
	});
}
