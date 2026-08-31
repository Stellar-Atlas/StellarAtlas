import express from 'express';
import request from 'supertest';
import type { DataSource } from 'typeorm';
import { StrKey } from '@stellar/stellar-sdk';
import { historyAnalyticsRouter } from '../HistoryAnalyticsRouter.js';

describe('HistoryAnalyticsRouter.integration', () => {
	const issuer = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 7));
	const holder = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 9));

	it('returns one issued-asset holder from the completed ETL projection', async () => {
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
			.get(
				'/v1/analytics/assets/' +
					encodeURIComponent('USDC:' + issuer) +
					'/holders/' +
					holder
			)
			.expect(200)
			.expect('Cache-Control', 'public, max-age=10')
			.expect((response) => {
				expect(response.body).toMatchObject({
					address: holder,
					asset: {
						canonical: 'USDC:' + issuer,
						code: 'USDC',
						issuer,
						type: 'credit_alphanum4'
					},
					coverage: {
						complete: false,
						completeBatchCount: 23472,
						dataset: 'trustline-state-changes',
						immutableSource: 'stellar_atlas_lcm_parquet',
						servingSource: 'postgresql_state_projection',
						totalBatchCount: 40606
					},
					holder: {
						accountId: holder,
						active: true,
						authorized: true,
						authorizedToMaintainLiabilities: true,
						balance: '125.5000000',
						buyingLiabilities: '1.0000000',
						clawbackEnabled: true,
						limit: '1000.0000000',
						sellingLiabilities: '2.0000000'
					}
				});
			});

		expect(query).toHaveBeenCalledTimes(1);
		expect(query.mock.calls[0]?.[1]).toEqual([
			expect.any(Buffer),
			holder,
			'USDC',
			issuer
		]);
	});

	it('returns native account balance state through the resource route', async () => {
		const query = jest.fn().mockResolvedValue([
			{
				accountId: holder,
				assetType: 0,
				assetTypeString: 'native',
				balance: '50000000',
				buyingLiabilities: '0',
				changeIndex: '1',
				closedAtUnixMillis: '1788000000000',
				completeBatchCount: '10',
				dataset: 'account-state-changes',
				deleted: false,
				flags: '0',
				hasObservation: true,
				importedRecordCount: '20',
				lastModifiedLedger: '63',
				ledgerSequence: '63',
				limit: null,
				maximumImportedLedger: '1023',
				minimumImportedLedger: '2',
				operationIndex: null,
				reason: 'fee',
				sellingLiabilities: '0',
				totalBatchCount: '10',
				totalRecordCount: '20',
				transactionHash: 'cd'.repeat(32),
				transactionIndex: '1'
			}
		]);

		await request(buildApp(query))
			.get('/v1/analytics/assets/native/holders/' + holder)
			.expect(200)
			.expect((response) => {
				expect(response.body.asset.type).toBe('native');
				expect(response.body.coverage.complete).toBe(true);
				expect(response.body.holder.balance).toBe('5.0000000');
				expect(response.body.holder.limit).toBeNull();
			});
		expect(query.mock.calls[0]?.[1]).toEqual([
			expect.any(Buffer),
			holder
		]);
	});

	it('returns explicit incomplete coverage when no observation is imported', async () => {
		const query = jest.fn().mockResolvedValue([
			{
				accountId: null,
				assetType: null,
				assetTypeString: null,
				balance: null,
				buyingLiabilities: null,
				changeIndex: null,
				closedAtUnixMillis: null,
				completeBatchCount: '2',
				dataset: 'trustline-state-changes',
				deleted: null,
				flags: null,
				hasObservation: false,
				importedRecordCount: '10',
				lastModifiedLedger: null,
				ledgerSequence: null,
				limit: null,
				maximumImportedLedger: '127',
				minimumImportedLedger: '2',
				operationIndex: null,
				reason: null,
				sellingLiabilities: null,
				totalBatchCount: '4',
				totalRecordCount: '20',
				transactionHash: null,
				transactionIndex: null
			}
		]);

		await request(buildApp(query))
			.get(
				'/v1/analytics/assets/' +
					encodeURIComponent('USDC:' + issuer) +
					'/holders/' +
					holder
			)
			.expect(200)
			.expect((response) => {
				expect(response.body.coverage.complete).toBe(false);
				expect(response.body.holder).toBeNull();
			});
	});

	it('rejects malformed resource identifiers without querying PostgreSQL', async () => {
		const query = jest.fn();
		const app = buildApp(query);
		await request(app)
			.get('/v1/analytics/assets/USDC:not-an-account/holders/' + holder)
			.expect(400);
		await request(app)
			.get('/v1/analytics/assets/native/holders/not-an-account')
			.expect(400);
		expect(query).not.toHaveBeenCalled();
	});

	it('does not expose the obsolete Horizon query-parameter route', async () => {
		await request(buildApp(jest.fn()))
			.get('/v1/analytics/assets/holders?asset=native')
			.expect(404);
	});
});

function buildApp(query: jest.Mock): express.Application {
	const app = express();
	app.use(
		'/v1/analytics',
		historyAnalyticsRouter({
			dataSource: { query } as unknown as DataSource,
			networkPassphrase: 'Public Global Stellar Network ; September 2015'
		})
	);
	return app;
}
