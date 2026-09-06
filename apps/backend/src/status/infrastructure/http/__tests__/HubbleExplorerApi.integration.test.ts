import express from 'express';
import request from 'supertest';
import { registerHubbleExplorerRoutes } from '../HubbleExplorerRoutes.js';
import { mapExplorerRecord } from '../HubbleExplorerMapper.js';
import { operationLedger, queryExplorer } from '../HubbleExplorerQuery.js';
import { summarizeHubbleLedgerCoverage } from '../HubbleLedgerCoverage.js';
import { HubbleWarehouseUnavailableError } from '../HubbleWarehouseErrors.js';
import type {
	HubbleQuery,
	HubbleWarehouse,
	HubbleCatalog
} from '../HubbleWarehouseContracts.js';
const modern = 63490364,
	operationId = '272689036992143361';
const issuer = 'GBVVYDFLEBUNSWBHNJS3RSLLJTMJ46PJXTTMA3V6YJ4KDRMAEJIDUSDC';
const source = {
	_ledger_sequence: modern,
	_batch_id: '3dca0dce-5e01-4620-a95b-e95ce4a58323',
	_source_sha256: 'a'.repeat(64),
	_row_number: '128947',
	closed_at: '2026-07-15 16:43:50.000000'
};
const operation = {
	...source,
	id: operationId,
	transaction_id: '272689036992143360',
	source_account: 'GCX7LOMYJM54CXJPNTDZPMFSTQTQJTR5XR4DKZXLSWJG3R4B7GOADWXZ',
	type: 24,
	type_string: 'invoke_host_function',
	details_json: { parameters_decoded: [{ type: 'I128', value: '0' }] }
};
function warehouse(
	rows: readonly Record<string, unknown>[] = []
): HubbleWarehouse {
	const catalog: HubbleCatalog = {
		database: 'stellar_hubble_v2',
		datasets: [],
		generatedAt: '2026-09-06T00:00:00Z',
		coverage: summarizeHubbleLedgerCoverage([
			{ start_ledger: 2, end_ledger: 27830402 },
			{ start_ledger: 63490179, end_ledger: 63491202 }
		]),
		ingestion: {
			minimumLedger: '2',
			maximumLedger: '63491202',
			completedBatches: '1',
			startedBatches: '0',
			failedBatches: '0',
			totalRows: '1'
		},
		officialSchemaSource: 'stellar-etl'
	};
	return {
		catalog: jest.fn(async () => catalog),
		query: jest.fn(async (input: HubbleQuery) => ({
			columns: [],
			dataset: input.dataset,
			elapsedMilliseconds: 1,
			limit: input.limit ?? 25,
			offset: input.offset ?? 0,
			rows:
				input.dataset === 'history_transactions'
					? rows
							.filter((row) => row.transaction_id !== undefined)
							.map((row) => ({
								id: row.transaction_id,
								_ledger_sequence: row._ledger_sequence,
								transaction_hash:
									'446670351d9f2af449eda3bfa0e36c3e128e2720443293dd5b585b3bbadeb485'
							}))
					: rows
		})),
		classifyEventRows: jest.fn(async (r) => r),
		contractEvents: jest.fn(),
		transactionDetail: jest.fn(async () => null),
		transferActivity: jest.fn(),
		accountTransactions: jest.fn(),
		assetHolders: jest.fn()
	};
}
function app(w: HubbleWarehouse) {
	const a = express();
	const r = express.Router();
	registerHubbleExplorerRoutes(r, w);
	a.use('/v1/analytics', r);
	return a;
}
describe('bounded parsed explorer', () => {
	it('decodes the actual modern operation id without floating point rounding', () => {
		expect(operationLedger(operationId)).toBe(modern);
		expect(() => operationLedger('900719925474099200000000')).toThrow();
	});
	it('maps the real invocation shape preserving nested values and exact IDs', () => {
		expect(mapExplorerRecord('operations', operation)).toMatchObject({
			id: operationId,
			transactionId: '272689036992143360',
			ledgerSequence: modern,
			type: 'invoke_host_function',
			typeCode: 24,
			closedAt: '2026-07-15T16:43:50.000Z',
			details: { parameters_decoded: [{ type: 'I128', value: '0' }] }
		});
	});
	it('queries operation detail only in its encoded ledger', async () => {
		const w = warehouse([operation]);
		const r = await request(app(w))
			.get('/v1/analytics/operations/' + operationId + '?view=typed')
			.expect(200);
		expect(r.body.record.id).toBe(operationId);
		expect(r.body.record.transactionHash).toBe(
			'446670351d9f2af449eda3bfa0e36c3e128e2720443293dd5b585b3bbadeb485'
		);
		expect(w.query).toHaveBeenCalledTimes(2);
		expect(r.body.coverageStatus).toBe('partial_or_unknown');
		expect(w.query).toHaveBeenCalledWith(
			expect.objectContaining({
				filters: expect.arrayContaining([
					{ field: '_ledger_sequence', operator: 'gte', value: modern },
					{ field: '_ledger_sequence', operator: 'lte', value: modern },
					{ field: 'id', operator: 'eq', value: operationId }
				])
			})
		);
	});
	it('uses server DISTINCT asset identities rather than repeated ledger observations', async () => {
		const w = warehouse([
			{
				asset_type: 'credit_alphanum4',
				asset_code: 'USDC',
				asset_issuer: issuer
			}
		]);
		const r = await request(app(w))
			.get('/v1/analytics/assets?min_ledger=63490364&max_ledger=63490364')
			.expect(200);
		expect(r.body.rows[0].id).toBe('USDC:' + issuer);
		expect(w.query).toHaveBeenCalledWith(
			expect.objectContaining({
				distinct: true,
				select: ['asset_type', 'asset_code', 'asset_issuer']
			})
		);
	});
	it('uses an explicit shared million-ledger range policy, not a new tiny hard cap', async () => {
		const w = warehouse();
		await request(app(w))
			.get('/v1/analytics/offers?min_ledger=2000000&max_ledger=2010000')
			.expect(200);
		await request(app(w))
			.get('/v1/analytics/offers?min_ledger=2&max_ledger=1000002')
			.expect(400);
	});
	it('defaults to a small explicit newest parsed window and supplies continuation', async () => {
		const w = warehouse([
			{ contract_id: 'C' + 'A'.repeat(55) },
			{ contract_id: 'C' + 'B'.repeat(55) }
		]);
		const r = await request(app(w))
			.get('/v1/analytics/contracts?limit=1')
			.expect(200);
		expect(r.body.window).toEqual({ minLedger: 63491139, maxLedger: 63491202 });
		expect(r.body.nextOffset).toBe(1);
		expect(r.body.rows).toHaveLength(1);
	});
	it('returns 404 for absence in a completed range and 409 for a not-fully-ingested range', async () => {
		const w = warehouse();
		await request(app(w))
			.get('/v1/analytics/offers/1?min_ledger=3&max_ledger=3')
			.expect(404);
		const r = await request(app(w))
			.get('/v1/analytics/offers/1?min_ledger=40000000&max_ledger=40000000')
			.expect(409);
		expect(r.body.code).toBe('hubble_range_not_fully_ingested');
	});
	it('keeps actual warehouse failure separate from absent data', async () => {
		const w = warehouse();
		jest
			.spyOn(w, 'query')
			.mockRejectedValue(new HubbleWarehouseUnavailableError('read failed'));
		const quiet = jest.spyOn(console, 'error').mockImplementation(() => {});
		await request(app(w)).get('/v1/analytics/assets').expect(503);
		quiet.mockRestore();
	});
	it('rejects invalid IDs, duplicate params, unknown filters and reversed dates', async () => {
		const w = warehouse();
		await request(app(w))
			.get('/v1/analytics/contracts/not-a-contract')
			.expect(400);
		await request(app(w))
			.get('/v1/analytics/assets?limit=2&limit=3')
			.expect(400);
		await request(app(w)).get('/v1/analytics/assets?foo=bar').expect(400);
		await request(app(w))
			.get(
				'/v1/analytics/assets?start_time=2026-07-16T00:00:00Z&end_time=2026-07-15T00:00:00Z'
			)
			.expect(400);
		expect(w.query).not.toHaveBeenCalled();
	});
	it('applies validated time predicates without losing ledger bounds', async () => {
		const w = warehouse();
		await request(app(w))
			.get(
				'/v1/analytics/trades?view=typed&min_ledger=63490364&max_ledger=63490364&start_time=2026-07-15T00:00:00Z'
			)
			.expect(200);
		expect(w.query).toHaveBeenCalledWith(
			expect.objectContaining({
				filters: expect.arrayContaining([
					{
						field: 'ledger_closed_at',
						operator: 'gte',
						value: '2026-07-15 00:00:00.000'
					}
				])
			})
		);
	});
	it('accepts dynamic asset pair filters and preserves native identity', async () => {
		const w = warehouse();
		await request(app(w))
			.get(
				'/v1/analytics/offers?min_ledger=2&max_ledger=3&selling_asset=native&buying_asset=' +
					encodeURIComponent('USDC:' + issuer)
			)
			.expect(200);
		expect(w.query).toHaveBeenCalledWith(
			expect.objectContaining({
				filters: expect.arrayContaining([
					{ field: 'selling_asset_type', operator: 'eq', value: 'native' },
					{ field: 'buying_asset_code', operator: 'eq', value: 'USDC' },
					{ field: 'buying_asset_issuer', operator: 'eq', value: issuer }
				])
			})
		);
	});
	it('keeps legacy operation and trade routes available unless view=typed is requested', async () => {
		const w = warehouse();
		await request(app(w))
			.get('/v1/analytics/operations/' + operationId)
			.expect(404);
		await request(app(w)).get('/v1/analytics/trades').expect(404);
		expect(w.query).not.toHaveBeenCalled();
	});
	it('labels float source amounts without inventing exact decimal precision', () => {
		const row = {
			...source,
			offer_id: '1848813589',
			seller_id: 'G' + 'A'.repeat(55),
			selling_asset_type: 'native',
			selling_asset_code: '',
			selling_asset_issuer: '',
			buying_asset_type: 'credit_alphanum4',
			buying_asset_code: 'USDC',
			buying_asset_issuer: issuer,
			amount: 1074.6636081,
			pricen: 5003537,
			priced: 5000000,
			deleted: false,
			last_modified_ledger: modern
		};
		expect(mapExplorerRecord('offers', row)).toMatchObject({
			id: '1848813589',
			amount: '1074.6636081',
			amountPrecision: 'source_float64',
			price: { numerator: '5003537', denominator: '5000000' },
			deleted: false
		});
		expect(() =>
			mapExplorerRecord('offers', { ...row, offer_id: 9007199254740992 })
		).toThrow();
	});
	it('does not claim latest observed offers are the current order book', async () => {
		const r = await queryExplorer(warehouse(), {
			entity: 'offers',
			filters: {},
			minLedger: 2,
			maxLedger: 3
		});
		expect(r.semantics).toContain('not the current order book');
	});

	it('finds an event-observed contract before its state batch boundary without widening the window', async () => {
		const w = warehouse(),
			contractId = 'CDL74RF5BLYR2YBLCCI7F5FB6TPSCLKEJUBSD2RSVWZ4YHF3VMFAIGWA';
		jest.spyOn(w, 'query').mockImplementation(async (input: HubbleQuery) => ({
			dataset: input.dataset,
			columns: ['contract_id'],
			elapsedMilliseconds: 1,
			limit: 1,
			offset: 0,
			rows:
				input.dataset === 'history_contract_events'
					? [{ contract_id: contractId }]
					: []
		}));
		const r = await request(app(w))
			.get(
				'/v1/analytics/contracts/' +
					contractId +
					'?min_ledger=63490364&max_ledger=63490364'
			)
			.expect(200);
		expect(r.body.record.id).toBe(contractId);
		expect(w.query).toHaveBeenCalledTimes(2);
		expect(w.query).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				dataset: 'history_contract_events',
				limit: 1,
				distinct: true,
				select: ['contract_id'],
				filters: expect.arrayContaining([
					{ field: '_ledger_sequence', operator: 'gte', value: modern },
					{ field: '_ledger_sequence', operator: 'lte', value: modern },
					{ field: 'contract_id', operator: 'eq', value: contractId }
				])
			})
		);
	});
	it('accepts authoritative stored symbolic operation types as well as numeric codes', async () => {
		const w = warehouse();
		await request(app(w))
			.get('/v1/analytics/operations?type=invoke_host_function')
			.expect(200);
		expect(w.query).toHaveBeenLastCalledWith(
			expect.objectContaining({
				filters: expect.arrayContaining([
					{
						field: 'type_string',
						operator: 'eq',
						value: 'invoke_host_function'
					}
				])
			})
		);
		await request(app(w)).get('/v1/analytics/operations?type=24').expect(200);
		expect(w.query).toHaveBeenLastCalledWith(
			expect.objectContaining({
				filters: expect.arrayContaining([
					{ field: 'type', operator: 'eq', value: '24' }
				])
			})
		);
		await request(app(w))
			.get('/v1/analytics/operations?type=bad-name')
			.expect(400);
	});
});
