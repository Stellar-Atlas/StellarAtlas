import express from 'express';
import request from 'supertest';
import type { DataSource } from 'typeorm';
import { StrKey } from '@stellar/stellar-sdk';
import { historyAnalyticsGraphqlHandler } from '../HistoryAnalyticsGraphql.js';

describe('HistoryAnalyticsGraphql.integration', () => {
	const issuer = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 7));
	const holder = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 9));

	it('exposes the current Hubble implementation status honestly', async () => {
		await request(buildApp(jest.fn()))
			.post('/graphql')
			.send({
				query:
					'{ hubbleStatus { compatibility officialSchemaSource servingWarehouse availableQueries } }'
			})
			.expect(200)
			.expect((response) => {
				expect(response.body.data.hubbleStatus).toEqual({
					availableQueries: ['assetHolder'],
					compatibility: 'building',
					officialSchemaSource:
						'github.com/stellar/stellar-etl/v2/internal/transform',
					servingWarehouse: 'postgresql-operational-projection'
				});
			});
	});

	it('serves the same historical holder lookup as REST', async () => {
		const query = jest.fn().mockResolvedValue([
			{
				accountId: holder,
				assetType: 1,
				assetTypeString: 'credit_alphanum4',
				balance: '1255000000',
				buyingLiabilities: '10000000',
				changeIndex: '3',
				closedAtUnixMillis: '1788000000000',
				completeBatchCount: '23472',
				dataset: 'trustline-state-changes',
				deleted: false,
				flags: '7',
				hasObservation: true,
				importedRecordCount: '452508728',
				lastModifiedLedger: '64000001',
				ledgerSequence: '64000002',
				limit: '10000000000',
				maximumImportedLedger: '63493250',
				minimumImportedLedger: '2',
				operationIndex: '2',
				reason: 'operation',
				sellingLiabilities: '20000000',
				totalBatchCount: '40606',
				totalRecordCount: '6542264287',
				transactionHash: 'ab'.repeat(32),
				transactionIndex: '1'
			}
		]);

		await request(buildApp(query))
			.post('/graphql')
			.send({
				query: `
					query Holder($assetId: String!, $address: String!) {
						assetHolder(assetId: $assetId, address: $address) {
							address
							coverage { complete completeBatchCount totalBatchCount }
							holder { accountId balance authorized clawbackEnabled }
						}
					}
				`,
				variables: { address: holder, assetId: 'USDC:' + issuer }
			})
			.expect(200)
			.expect((response) => {
				expect(response.body.errors).toBeUndefined();
				expect(response.body.data.assetHolder).toMatchObject({
					address: holder,
					coverage: {
						complete: false,
						completeBatchCount: 23472,
						totalBatchCount: 40606
					},
					holder: {
						accountId: holder,
						authorized: true,
						balance: '125.5000000',
						clawbackEnabled: true
					}
				});
			});
		expect(query).toHaveBeenCalledTimes(1);
	});

	it('returns a typed GraphQL input error without querying PostgreSQL', async () => {
		const query = jest.fn();
		await request(buildApp(query))
			.post('/graphql')
			.send({
				query:
					'{ assetHolder(assetId: "not-an-asset", address: "bad") { address } }'
			})
			.expect(200)
			.expect((response) => {
				expect(response.body.errors[0].extensions.code).toBe('BAD_USER_INPUT');
			});
		expect(query).not.toHaveBeenCalled();
	});
});

function buildApp(query: jest.Mock): express.Application {
	const app = express();
	app.use(express.json());
	app.all(
		'/graphql',
		historyAnalyticsGraphqlHandler({
			dataSource: { query } as unknown as DataSource,
			networkPassphrase: 'Public Global Stellar Network ; September 2015'
		})
	);
	return app;
}
