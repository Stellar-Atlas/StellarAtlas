import express from 'express';
import request from 'supertest';
import { mock } from 'jest-mock-extended';
import { registerHubbleExplorerRoutes } from '../HubbleExplorerRoutes.js';
import { hubbleWarehouseGraphqlHandler } from '../HubbleWarehouseGraphql.js';
import { mapExplorerRecord } from '../HubbleExplorerMapper.js';
import { summarizeHubbleLedgerCoverage } from '../HubbleLedgerCoverage.js';
import type { HubbleWarehouse } from '../HubbleWarehouseContracts.js';

// Actual completed observation returned by the read-only dataset API on 2026-09-08.
const row = {
	liquidity_pool_id:
		'f82c4083862934876ec3c9f67fa60521da6a0d83789fa3123bd8dc1d268c03b6',
	liquidity_pool_id_strkey:
		'LD4CYQEDQYUTJB3OYPE7M75GAUQ5U2QNQN4J7IYSHPMNYHJGRQB3MQZG',
	type: 'constant_product',
	fee: 30,
	trustline_count: '4',
	pool_share_count: 83.8077031,
	asset_a_type: 'native',
	asset_a_code: '',
	asset_a_issuer: '',
	asset_a_amount: 1635.3635675,
	asset_b_type: 'credit_alphanum4',
	asset_b_code: '224',
	asset_b_issuer: 'GBN42AP5SK3IPTEJ2KAY7DLCAH6YQSMI3H6CCZLWW7KIJCYJ3X57JZ6R',
	asset_b_amount: 3259.9386692,
	deleted: false,
	last_modified_ledger: 63491202,
	_ledger_sequence: 63491202,
	closed_at: '2026-07-15 18:05:02.000000',
	_batch_id: '3dca0dce-5e01-4620-a95b-e95ce4a58323',
	_source_sha256:
		'78dadc18671e087b3e9169c34601c932d5215aafc1d14ae7ec81e9bf0ddc2426',
	_row_number: '30979'
};
function setup(rows: readonly Record<string, unknown>[] = [row]) {
	const warehouse = mock<HubbleWarehouse>();
	warehouse.catalog.mockResolvedValue({
		database: 'stellar_hubble_v2',
		datasets: [],
		generatedAt: '2026-09-08T09:49:16Z',
		officialSchemaSource: 'stellar-etl',
		coverage: summarizeHubbleLedgerCoverage([
			{ start_ledger: 2, end_ledger: 29558914 },
			{ start_ledger: 63490179, end_ledger: 63491202 }
		]),
		ingestion: {
			minimumLedger: '2',
			maximumLedger: '63491202',
			completedBatches: '1',
			startedBatches: '0',
			failedBatches: '0',
			totalRows: '1'
		}
	});
	warehouse.query.mockImplementation(async (input) => ({
		dataset: input.dataset,
		columns: [],
		rows,
		limit: input.limit!,
		offset: input.offset!,
		elapsedMilliseconds: 1
	}));
	const app = express(),
		router = express.Router();
	app.use(express.json());
	registerHubbleExplorerRoutes(router, warehouse);
	app.use('/v1/analytics', router);
	app.post('/graphql', hubbleWarehouseGraphqlHandler(warehouse));
	return { app, warehouse };
}
describe('native liquidity-pool observations', () => {
	it('serves the retained native pair with lookahead pagination and source precision', async () => {
		const { app, warehouse } = setup([row, { ...row, _row_number: '30978' }]);
		const response = await request(app)
			.get(
				'/v1/analytics/liquidity-pools?min_ledger=63491202&max_ledger=63491202&asset_a=native&deleted=false&limit=1'
			)
			.expect(200);
		expect(response.body).toMatchObject({
			nextOffset: 1,
			coverageStatus: 'complete',
			rows: [
				{
					id: row.liquidity_pool_id,
					reserveA: '1635.3635675',
					reserveB: '3259.9386692',
					amountPrecision: 'source_float64',
					assetA: { id: 'native' },
					sourceRecord: { rowNumber: '30979' }
				}
			]
		});
		expect(response.body.semantics).toContain('Rows are not distinct pools');
		expect(warehouse.query).toHaveBeenCalledWith(
			expect.objectContaining({
				dataset: 'liquidity_pools',
				limit: 2,
				filters: expect.arrayContaining([
					{ field: '_ledger_sequence', operator: 'gte', value: 63491202 },
					{ field: '_ledger_sequence', operator: 'lte', value: 63491202 },
					{ field: 'asset_a_type', operator: 'eq', value: 'native' },
					{ field: 'deleted', operator: 'eq', value: false }
				])
			})
		);
	});
	it('resolves a checksum-valid pool address to its canonical hash without widening the window', async () => {
		const { app, warehouse } = setup();
		await request(app)
			.get(
				'/v1/analytics/liquidity-pools/' +
					row.liquidity_pool_id_strkey +
					'?min_ledger=63491202&max_ledger=63491202'
			)
			.expect(200);
		expect(warehouse.query).toHaveBeenCalledWith(
			expect.objectContaining({
				limit: 1,
				filters: expect.arrayContaining([
					{
						field: 'liquidity_pool_id',
						operator: 'eq',
						value: row.liquidity_pool_id
					}
				])
			})
		);
		await request(app)
			.get(
				'/v1/analytics/liquidity-pools/' +
					row.liquidity_pool_id_strkey.slice(0, -1) +
					'A'
			)
			.expect(400);
		await request(app)
			.get('/v1/analytics/liquidity-pools?deleted=no')
			.expect(400);
		expect(warehouse.query).toHaveBeenCalledTimes(1);
	});
	it('does not fabricate zero reserves for a removed pool', () => {
		expect(
			mapExplorerRecord('liquidity-pools', {
				...row,
				deleted: true,
				asset_a_amount: 0,
				asset_b_amount: 0
			})
		).toMatchObject({
			deleted: true,
			reserveA: null,
			reserveB: null,
			assetA: null,
			shares: null,
			feeBasisPoints: null
		});
	});
	it('distinguishes missing completed-window observations from missing coverage', async () => {
		const { app } = setup([]);
		await request(app)
			.get(
				'/v1/analytics/liquidity-pools/' +
					row.liquidity_pool_id +
					'?min_ledger=63491202&max_ledger=63491202'
			)
			.expect(404);
		await request(app)
			.get(
				'/v1/analytics/liquidity-pools/' +
					row.liquidity_pool_id +
					'?min_ledger=40000000&max_ledger=40000000'
			)
			.expect(409);
	});
	it('exposes the same typed native pool fields and filters through GraphQL', async () => {
		const { app, warehouse } = setup();
		const response = await request(app)
			.post('/graphql')
			.send({
				query:
					'{ nativeLiquidityPools(input:{minLedger:63491202,maxLedger:63491202,limit:1,assetA:"native",deleted:false}) { rows { id poolAddress assetA { id } reserveA feeBasisPoints trustlineCount amountPrecision deleted sourceRecord { rowNumber } } nextOffset coverageStatus } }'
			})
			.expect(200);
		expect(response.body.errors).toBeUndefined();
		expect(response.body.data.nativeLiquidityPools.rows[0]).toMatchObject({
			id: row.liquidity_pool_id,
			assetA: { id: 'native' },
			reserveA: '1635.3635675',
			trustlineCount: '4'
		});
		expect(warehouse.query).toHaveBeenCalledWith(
			expect.objectContaining({
				dataset: 'liquidity_pools',
				filters: expect.arrayContaining([
					{ field: 'deleted', operator: 'eq', value: false }
				])
			})
		);
	});
});
