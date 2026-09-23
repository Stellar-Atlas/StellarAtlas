import express from 'express';
import request from 'supertest';
import { mock } from 'jest-mock-extended';
import { hubbleWarehouseGraphqlHandler } from '../HubbleWarehouseGraphql.js';
import { registerHubbleExplorerRoutes } from '../HubbleExplorerRoutes.js';
import { summarizeHubbleLedgerCoverage } from '../HubbleLedgerCoverage.js';
import type { HubbleWarehouse } from '../HubbleWarehouseContracts.js';
import { HubbleWarehouseUnavailableError } from '../HubbleWarehouseErrors.js';

const ledger = 63490364;
const account = 'G' + 'A'.repeat(55),
	contract = 'C' + 'B'.repeat(55);
const transactionId = ((BigInt(ledger) << 32n) + 4096n).toString();
const operationId = (BigInt(transactionId) + 1n).toString();
const hash = 'a'.repeat(64);
const operation = {
	_ledger_sequence: ledger,
	_row_number: '9007199254740993',
	_batch_id: '3dca0dce-5e01-4620-a95b-e95ce4a58323',
	_source_sha256: 'b'.repeat(64),
	id: operationId,
	transaction_id: transactionId,
	source_account: account,
	type_string: 'payment',
	type: 1,
	details_json: '{"amount":"1.0000000"}',
	closed_at: '2026-07-15 16:43:50'
};
const coverage = summarizeHubbleLedgerCoverage([
	{ start_ledger: ledger, end_ledger: ledger + 2 }
]);
function fixture(rows: readonly Record<string, unknown>[]) {
	const warehouse = mock<HubbleWarehouse>();
	warehouse.catalog.mockResolvedValue({
		database: 'stellar_hubble',
		coverage,
		datasets: [],
		generatedAt: '2026-09-07T00:00:00.000Z',
		ingestion: {
			completedBatches: '1',
			failedBatches: '0',
			maximumLedger: String(ledger + 2),
			minimumLedger: String(ledger),
			startedBatches: '0',
			totalRows: '3'
		},
		officialSchemaSource: 'fixture'
	});
	warehouse.query.mockImplementation(async (input) => ({
		columns: [],
		dataset: input.dataset,
		elapsedMilliseconds: 1,
		limit: input.limit ?? 100,
		offset: input.offset ?? 0,
		rows:
			input.dataset === 'history_transactions'
				? [
						{
							id: transactionId,
							transaction_hash: hash,
							_ledger_sequence: ledger
						}
					]
				: rows
	}));
	const app = express(),
		router = express.Router();
	app.use(express.json());
	registerHubbleExplorerRoutes(router, warehouse);
	app.use('/v1/analytics', router);
	app.all('/graphql', hubbleWarehouseGraphqlHandler(warehouse));
	return { app, warehouse };
}
const cases = [
	{
		entity: 'operations',
		list: 'hubbleOperations',
		detail: 'hubbleOperation',
		input: 'HubbleOperationInput',
		row: operation,
		id: operationId,
		filters: { sourceAccount: account, type: 'payment' },
		rest: { source_account: account, type: 'payment' },
		fields:
			'id transactionId transactionHash sourceAccount type typeCode details ledgerSequence closedAt sourceRecord { batchId digest rowNumber }'
	},
	{
		entity: 'assets',
		list: 'hubbleAssets',
		detail: 'hubbleAsset',
		input: 'HubbleAssetInput',
		row: {
			asset_type: 'credit_alphanum4',
			asset_code: 'USD',
			asset_issuer: account
		},
		id: 'USD:' + account,
		filters: { assetCode: 'USD', assetIssuer: account },
		rest: { asset_code: 'USD', asset_issuer: account },
		fields: 'id type code issuer'
	},
	{
		entity: 'contracts',
		list: 'hubbleContracts',
		detail: 'hubbleContract',
		input: 'HubbleExplorerPageInput',
		row: { contract_id: contract },
		id: contract,
		filters: {},
		rest: {},
		fields: 'id'
	}
];
describe('typed explorer GraphQL parity', () => {
	it.each(cases)(
		'reuses REST $entity filters, pagination, mapping and relationship queries',
		async (c) => {
			const f = fixture([c.row, c.row]);
			const window = {
				minLedger: ledger,
				maxLedger: ledger + 2,
				startTime: '2026-07-15T00:00:00Z',
				endTime: '2026-07-16T00:00:00Z',
				limit: 1,
				offset: 2
			};
			const rest = await request(f.app)
				.get('/v1/analytics/' + c.entity)
				.query({
					view: 'typed',
					min_ledger: ledger,
					max_ledger: ledger + 2,
					start_time: window.startTime,
					end_time: window.endTime,
					limit: 1,
					offset: 2,
					...c.rest
				})
				.expect(200);
			const restCalls = f.warehouse.query.mock.calls.map(([input]) => input);
			f.warehouse.query.mockClear();
			const gql = await request(f.app)
				.post('/graphql')
				.send({
					query: `query($input:${c.input}) { ${c.list}(input:$input) { entity limit offset nextOffset coverageStatus semantics source window { minLedger maxLedger } coverage { completedRanges { firstLedger lastLedger } } rows { ${c.fields} } } }`,
					variables: { input: { ...window, ...c.filters } }
				})
				.expect(200);
			expect(gql.body.errors).toBeUndefined();
			expect(gql.body.data[c.list]).toMatchObject({
				entity: c.entity,
				limit: 1,
				offset: 2,
				nextOffset: 3,
				coverageStatus: 'complete',
				rows: [rest.body.rows[0]]
			});
			expect(f.warehouse.query.mock.calls.map(([input]) => input)).toEqual(
				restCalls
			);
			if (c.entity === 'operations')
				expect(gql.body.data[c.list].rows[0]).toMatchObject({
					transactionHash: hash,
					sourceRecord: { rowNumber: '9007199254740993' }
				});
		}
	);
	it.each(cases)(
		'reuses REST $entity detail and keeps partial-window absence explicit',
		async (c) => {
			const f = fixture([c.row]);
			const rest = await request(f.app)
				.get('/v1/analytics/' + c.entity + '/' + encodeURIComponent(c.id))
				.query({ view: 'typed', min_ledger: ledger, max_ledger: ledger })
				.expect(200);
			const restCalls = f.warehouse.query.mock.calls.map(([input]) => input);
			f.warehouse.query.mockClear();
			const query = `query($id:String!,$input:HubbleExplorerWindowInput) { ${c.detail}(id:$id,input:$input) { record { ${c.fields} } coverageStatus semantics window { minLedger maxLedger } } }`;
			const gql = await request(f.app)
				.post('/graphql')
				.send({
					query,
					variables: {
						id: c.id,
						input: { minLedger: ledger, maxLedger: ledger }
					}
				})
				.expect(200);
			expect(gql.body.errors).toBeUndefined();
			expect(gql.body.data[c.detail].record).toEqual(rest.body.record);
			expect(f.warehouse.query.mock.calls.map(([input]) => input)).toEqual(
				restCalls
			);
			f.warehouse.query.mockResolvedValue({
				rows: [],
				columns: [],
				dataset: 'fixture',
				limit: 1,
				offset: 0,
				elapsedMilliseconds: 1
			});
			const missing = await request(f.app)
				.post('/graphql')
				.send({
					query,
					variables: {
						id: c.id,
						input: { minLedger: ledger - 1, maxLedger: ledger }
					}
				})
				.expect(200);
			expect(missing.body.errors).toBeUndefined();
			expect(missing.body.data[c.detail]).toMatchObject({
				record: null,
				coverageStatus: 'partial_or_unknown'
			});
		}
	);
	it.each([
		'{ hubbleOperations(input:{sourceAccount:"invalid"}) { limit } }',
		'{ hubbleOperations(input:{type:"not a type"}) { limit } }',
		'{ hubbleAssets(input:{assetCode:"invalid!"}) { limit } }',
		'{ hubbleAsset(id:"invalid") { record { id } } }',
		'{ hubbleContract(id:"invalid") { record { id } } }',
		'{ hubbleContracts(input:{limit:101}) { limit } }',
		'{ hubbleContracts(input:{offset:10001}) { limit } }',
		'{ hubbleContracts(input:{minLedger:1,maxLedger:1000001}) { limit } }',
		'{ hubbleOperations(input:{startTime:"2026-07-15T12:00:00+01:00"}) { limit } }'
	])('rejects invalid input before fact queries: %s', async (query) => {
		const f = fixture([]);
		const result = await request(f.app)
			.post('/graphql')
			.send({ query })
			.expect(200);
		expect(result.body.errors[0].extensions.code).toBe('BAD_USER_INPUT');
		expect(f.warehouse.query).not.toHaveBeenCalled();
	});
	it('preserves warehouse errors instead of returning an empty observed registry', async () => {
		const f = fixture([]),
			log = jest.spyOn(console, 'error').mockImplementation(() => undefined);
		f.warehouse.query.mockRejectedValue(
			new HubbleWarehouseUnavailableError('fixture unavailable')
		);
		try {
			const result = await request(f.app)
				.post('/graphql')
				.send({ query: '{ hubbleContracts { rows { id } } }' })
				.expect(200);
			expect(result.body.errors[0].extensions.code).toBe('SERVICE_UNAVAILABLE');
			expect(result.body.data).toBeNull();
		} finally {
			log.mockRestore();
		}
	});
});
