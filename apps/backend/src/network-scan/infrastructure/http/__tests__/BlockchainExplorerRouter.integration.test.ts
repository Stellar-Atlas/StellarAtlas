import express from 'express';
import request from 'supertest';
import { blockchainExplorerRouter } from '../BlockchainExplorerRouter.js';

const createApp = () => {
	const app = express();
	app.use(
		'/v1/explorer',
		blockchainExplorerRouter({
			getExplorerLocalReadModel: {
				execute: async () => ({
					generatedAt: '2026-07-06T00:00:00.000Z',
					indexes: {
						assetIndexReady: false,
						contractIndexReady: false,
						operationIndexReady: false,
						transactionIndexReady: false
					},
					parsedLedgerHeaders: {
						earliestParsedLedger: '64',
						latestObservedAt: '2026-07-06T00:00:00.000Z',
						latestParsedLedger: '128',
						latestParsedLedgerHash: 'hash-128',
						parsedLedgerCount: 2,
						sourceArchiveCount: 1
					},
					source: 'parsed_ledger_header_repository',
					transactions: {
						localCoverage: false,
						message:
							'Transactions remain Horizon fallback; no StellarAtlas local transaction index is available yet.',
						source: 'horizon_fallback'
					}
				})
			},
			getExplorerLocalTransactions: {
				execute: async (limit: number) => ({
					count: 1,
					generatedAt: '2026-07-06T00:00:00.000Z',
					limit,
					readModel: {
						assetIndexReady: false,
						contractIndexReady: false,
						envelopeJoinReady: true,
						evidenceSelection:
							'parsed_transaction_result_joined_to_parsed_ledger_header_and_envelope',
						ledgerHeaderJoinReady: true,
						operationIndexReady: false,
						parsedTransactionResultsReady: true
					},
					records: [
						{
							joins: {
								envelopeAvailable: true,
								ledgerHeaderAvailable: true
							},
							ledger: '63355967',
							ledgerHeaderHash: 'ledger-header-hash',
							localEvidence: {
								envelopeObservedAt: '2026-07-06T00:00:00.000Z',
								envelopeSourceArchiveUrl: 'https://archive-a.example',
								ledgerHeaderObservedAt: '2026-07-06T00:00:00.000Z',
								ledgerHeaderSourceArchiveUrl: 'https://archive-a.example',
								resultObservedAt: '2026-07-06T00:00:00.000Z',
								resultSourceArchiveUrl: 'https://archive-a.example'
							},
							protocolVersion: 27,
							transactionHash: 'a'.repeat(64),
							transactionIndex: 4,
							transactionResultHash: 'transaction-result-hash',
							transactionSetHash: 'transaction-set-hash'
						}
					],
					source: 'parsed_history_postgres'
				})
			},
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

	it('returns local parsed-header read model state without transaction coverage', async () => {
		await request(createApp())
			.get('/v1/explorer/local-read-model')
			.expect(200)
			.expect('Cache-Control', 'public, max-age=20')
			.expect((response) => {
				expect(response.body).toMatchObject({
					indexes: { transactionIndexReady: false },
					parsedLedgerHeaders: {
						latestParsedLedger: '128',
						latestParsedLedgerHash: 'hash-128'
					},
					source: 'parsed_ledger_header_repository',
					transactions: {
						localCoverage: false,
						source: 'horizon_fallback'
					}
				});
			});
	});

	it('returns local parsed transaction evidence', async () => {
		const fetchSpy = jest.spyOn(global, 'fetch');

		await request(createApp())
			.get('/v1/explorer/local-transactions?limit=2')
			.expect(200)
			.expect('Cache-Control', 'public, max-age=20')
			.expect((response) => {
				expect(response.body).toMatchObject({
					count: 1,
					limit: 2,
					readModel: {
						envelopeJoinReady: true,
						ledgerHeaderJoinReady: true,
						parsedTransactionResultsReady: true
					},
					records: [
						{
							joins: {
								envelopeAvailable: true,
								ledgerHeaderAvailable: true
							},
							ledger: '63355967',
							transactionHash: 'a'.repeat(64)
						}
					],
					source: 'parsed_history_postgres'
				});
			});

		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('rejects unbounded local transaction limits before any lookup', async () => {
		const fetchSpy = jest.spyOn(global, 'fetch');

		await request(createApp())
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

	it('returns transaction operation detail rows', async () => {
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

		await request(createApp())
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

		await request(createApp())
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

		await request(createApp())
			.get(`/v1/explorer/transactions/${'c'.repeat(64)}/operations`)
			.expect(404)
			.expect((response) => {
				expect(response.body).toEqual({ error: 'Transaction not found' });
			});
	});

	it('reports contract lookup as unconfigured until RPC is wired', async () => {
		await request(createApp())
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
