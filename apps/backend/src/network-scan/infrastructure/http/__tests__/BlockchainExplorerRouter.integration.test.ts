import request from 'supertest';
import {
	buildTestApp,
	canonicalFeed,
	canonicalHash,
	canonicalLedger,
	canonicalOperation
} from './BlockchainExplorerRouterTestFixture.js';

describe('BlockchainExplorerRouter.integration', () => {
	const contractId = `C${'A'.repeat(55)}`;

	afterEach(() => {
		jest.restoreAllMocks();
	});

	it('prefers a canonical ledger search result', async () => {
		const fetchSpy = jest.spyOn(global, 'fetch');

		await request(buildTestApp())
			.get(`/v1/explorer/search?query=${canonicalLedger.sequence}&type=ledger`)
			.expect(200)
			.expect('Cache-Control', 'public, max-age=20')
			.expect((response) => {
				expect(response.body).toMatchObject({
					query: canonicalLedger.sequence,
					resultType: 'ledger',
					source: 'postgres_canonical',
					result: canonicalLedger
				});
			});

		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('uses Horizon for ledger search only outside canonical coverage', async () => {
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

		await request(buildTestApp({ localLedger: null }))
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

	it('prefers canonical ledger detail without an external request', async () => {
		const fetchSpy = jest.spyOn(global, 'fetch');

		await request(buildTestApp())
			.get(`/v1/explorer/ledgers/${canonicalLedger.sequence}`)
			.expect(200)
			.expect((response) => {
				expect(response.body).toEqual(canonicalLedger);
			});

		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('returns bounded canonical transaction readiness without later indexes', async () => {
		await request(buildTestApp())
			.get('/v1/explorer/local-read-model')
			.expect(200)
			.expect('Cache-Control', 'public, max-age=20')
			.expect((response) => {
				expect(response.body).toMatchObject({
					indexes: {
						assetIndexReady: false,
						contractIndexReady: false,
						operationIndexReady: true,
						transactionIndexReady: true
					},
					parsedLedgerHeaders: {
						latestParsedLedger: '128',
						latestParsedLedgerHash: 'hash-128'
					},
					source: 'parsed_ledger_header_repository',
					transactions: {
						canonicalCoverage: {
							firstLedger: '63386240',
							lastLedger: '63386303'
						},
						localCoverage: true,
						source: 'postgres_canonical'
					}
				});
			});
	});

	it('returns local canonical transaction rows', async () => {
		const fetchSpy = jest.spyOn(global, 'fetch');

		await request(buildTestApp())
			.get('/v1/explorer/local-transactions?limit=2')
			.expect(200)
			.expect('Cache-Control', 'public, max-age=20')
			.expect((response) => {
				expect(response.body).toMatchObject({
					canonicalCoverage: {
						firstLedger: '63386240',
						lastLedger: '63386303'
					},
					count: 1,
					limit: 2,
					readModel: {
						assetIndexReady: false,
						contractIndexReady: false,
						operationIndexReady: true,
						transactionIndexReady: true
					},
					records: [
						{
							hash: canonicalHash,
							ledger: '63386303',
							source: 'postgres_canonical'
						}
					],
					source: 'postgres_canonical'
				});
			});

		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('rejects unbounded local transaction limits before any lookup', async () => {
		const fetchSpy = jest.spyOn(global, 'fetch');

		await request(buildTestApp())
			.get('/v1/explorer/local-transactions?limit=500')
			.expect(400)
			.expect((response) => {
				expect(response.body).toEqual({
					error: 'Invalid local transaction limit'
				});
			});

		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('rejects invalid account operation filters before Horizon lookup', async () => {
		const fetchSpy = jest.spyOn(global, 'fetch');

		await request(buildTestApp())
			.get('/v1/explorer/operations?accountId=not-an-account')
			.expect(400)
			.expect((response) => {
				expect(response.body).toEqual({ error: 'Invalid operation filters' });
			});

		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('serves operation filters from the complete canonical index', async () => {
		const fetchSpy = jest.spyOn(global, 'fetch');

		await request(buildTestApp())
			.get(
				`/v1/explorer/operations?ledger=63386303&accountId=${canonicalOperation.sourceAccount}&operationType=payment&from=2026-07-08T16%3A00%3A00.000Z&to=2026-07-08T17%3A00%3A00.000Z`
			)
			.expect(200)
			.expect((response) => {
				expect(response.body).toMatchObject({
					coverage: { complete: true },
					records: [
						{
							id: `${canonicalHash}:0`,
							outcome: 'succeeded',
							outcomeAvailable: true,
							source: 'postgres_canonical',
							transactionHash: canonicalHash,
							type: 'payment'
						}
					],
					source: 'postgres_canonical'
				});
			});

		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('prefers the bounded canonical recent transaction feed', async () => {
		const fetchSpy = jest.spyOn(global, 'fetch');

		await request(buildTestApp())
			.get('/v1/explorer/transactions?limit=10')
			.expect(200)
			.expect((response) => {
				expect(response.body).toMatchObject({
					limit: 10,
					source: 'postgres_canonical',
					truncated: true,
					records: [
						{
							hash: canonicalHash,
							ledger: '63386303',
							source: 'postgres_canonical'
						}
					]
				});
			});

		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('uses Horizon for the recent feed only when no canonical row exists', async () => {
		const app = buildTestApp({ localFeed: canonicalFeed([]) });
		jest.spyOn(global, 'fetch').mockResolvedValue(
			new Response(
				JSON.stringify({
					_embedded: {
						records: [
							{
								created_at: '2026-07-12T05:11:31Z',
								fee_charged: '100',
								hash: 'b'.repeat(64),
								ledger: 63400000,
								operation_count: 1,
								source_account: `G${'B'.repeat(55)}`,
								successful: true
							}
						]
					}
				}),
				{ status: 200 }
			)
		);

		await request(app)
			.get('/v1/explorer/transactions?limit=10')
			.expect(200)
			.expect((response) => {
				expect(response.body).toMatchObject({
					source: 'horizon',
					records: [{ hash: 'b'.repeat(64), source: 'horizon' }]
				});
			});
	});

	it('prefers canonical hash lookup on explorer and legacy routes', async () => {
		const fetchSpy = jest.spyOn(global, 'fetch');

		for (const path of [
			`/v1/explorer/transactions/${canonicalHash}`,
			`/v1/transactions/${canonicalHash}`
		]) {
			await request(buildTestApp())
				.get(path)
				.expect(200)
				.expect((response) => {
					expect(response.body).toMatchObject({
						hash: canonicalHash,
						ledger: '63386303',
						source: 'postgres_canonical'
					});
				});
		}

		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('prefers canonical transaction search before an external lookup', async () => {
		const fetchSpy = jest.spyOn(global, 'fetch');

		await request(buildTestApp())
			.get(`/v1/explorer/search?query=${canonicalHash}&type=transaction`)
			.expect(200)
			.expect((response) => {
				expect(response.body).toMatchObject({
					query: canonicalHash,
					resultType: 'transaction',
					source: 'postgres_canonical',
					result: {
						hash: canonicalHash,
						ledger: '63386303',
						source: 'postgres_canonical'
					}
				});
			});

		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('falls back to Horizon when a transaction hash is outside local coverage', async () => {
		const app = buildTestApp({ localTransaction: null });
		const hash = 'c'.repeat(64);
		jest.spyOn(global, 'fetch').mockResolvedValue(
			new Response(
				JSON.stringify({
					created_at: '2026-07-12T05:11:31Z',
					fee_charged: '100',
					hash,
					ledger: 63400000,
					operation_count: 1,
					source_account: `G${'C'.repeat(55)}`,
					successful: true
				}),
				{ status: 200 }
			)
		);

		await request(app)
			.get(`/v1/explorer/transactions/${hash}`)
			.expect(200)
			.expect((response) => {
				expect(response.body).toMatchObject({ hash, source: 'horizon' });
			});
	});

	it('rejects unbounded transaction feed limits', async () => {
		const fetchSpy = jest.spyOn(global, 'fetch');

		await request(buildTestApp())
			.get('/v1/explorer/transactions?limit=500')
			.expect(400)
			.expect((response) => {
				expect(response.body).toEqual({ error: 'Invalid transaction limit' });
			});

		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('returns canonical transaction operation detail rows without Horizon', async () => {
		const fetchSpy = jest.spyOn(global, 'fetch');

		await request(buildTestApp())
			.get(`/v1/explorer/transactions/${canonicalHash}/operations`)
			.expect(200)
			.expect((response) => {
				expect(response.body).toMatchObject({
					coverage: { complete: true },
					records: [
						{
							id: `${canonicalHash}:0`,
							source: 'postgres_canonical'
						}
					],
					source: 'postgres_canonical'
				});
			});

		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('uses Horizon transaction operations only outside canonical coverage', async () => {
		const transactionHash = 'b'.repeat(64);
		jest.spyOn(global, 'fetch').mockResolvedValue(
			new Response(
				JSON.stringify({
					_embedded: {
						records: [
							{
								created_at: '2026-07-05T05:11:32Z',
								id: '12345',
								ledger: 63335066,
								source_account: `G${'B'.repeat(55)}`,
								transaction_hash: transactionHash,
								transaction_successful: true,
								type: 'payment',
								type_i: 1
							}
						]
					}
				}),
				{ status: 200 }
			)
		);

		await request(buildTestApp({ localTransaction: null }))
			.get(`/v1/explorer/transactions/${transactionHash}/operations`)
			.expect(200)
			.expect((response) => {
				expect(response.body).toMatchObject({
					filters: { transactionHash },
					source: 'horizon',
					truncated: false,
					records: [
						{
							id: '12345',
							ledger: '63335066',
							transactionHash,
							type: 'payment'
						}
					]
				});
			});
	});

	it('rejects invalid transaction operation hashes before Horizon lookup', async () => {
		const fetchSpy = jest.spyOn(global, 'fetch');

		await request(buildTestApp())
			.get('/v1/explorer/transactions/not-a-hash/operations')
			.expect(400)
			.expect((response) => {
				expect(response.body).toEqual({ error: 'Invalid transaction hash' });
			});

		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('returns not found when Horizon has no transaction operation page', async () => {
		jest
			.spyOn(global, 'fetch')
			.mockResolvedValue(new Response('{}', { status: 404 }));

		await request(buildTestApp({ localTransaction: null }))
			.get(`/v1/explorer/transactions/${'c'.repeat(64)}/operations`)
			.expect(404)
			.expect((response) => {
				expect(response.body).toEqual({ error: 'Transaction not found' });
			});
	});

	it('reports contract lookup as unconfigured until RPC is wired', async () => {
		await request(buildTestApp())
			.get(`/v1/explorer/contracts/${contractId}`)
			.expect(200)
			.expect((response) => {
				expect(response.body).toMatchObject({
					probe: 'not_run',
					readiness: 'planned',
					source: 'rpc',
					status: 'not_configured'
				});
			});
	});
});
