import express from 'express';
import request from 'supertest';
import { mock } from 'jest-mock-extended';
import { hubbleWarehouseGraphqlHandler } from '../HubbleWarehouseGraphql.js';
import { hubbleWarehouseRouter } from '../HubbleWarehouseRouter.js';
import type { HubbleWarehouse } from '../HubbleWarehouseContracts.js';
import { summarizeHubbleLedgerCoverage } from '../HubbleLedgerCoverage.js';
import { HubbleWarehouseInputError } from '../HubbleWarehouseErrors.js';

function fixture() {
	const warehouse = mock<HubbleWarehouse>();
	warehouse.query.mockResolvedValue({
		dataset: 'history_operations',
		columns: ['type', 'records'],
		rows: [{ type: 1, records: '9007199254740993' }],
		limit: 2,
		offset: 0,
		nextOffset: null,
		elapsedMilliseconds: 1,
		aggregates: [
			{
				alias: 'records',
				function: 'count',
				field: null,
				sourceType: null,
				valueEncoding: 'string-or-null',
				approximate: false
			}
		],
		coverage: summarizeHubbleLedgerCoverage([
			{ start_ledger: 2, end_ledger: 65 }
		]),
		coverageStatus: 'complete',
		window: { minLedger: 2, maxLedger: 65 },
		semantics: 'Completed parsed rows within the requested window'
	});
	const app = express();
	app.use(express.json());
	app.use('/v1/analytics', hubbleWarehouseRouter({ warehouse }));
	app.all('/graphql', hubbleWarehouseGraphqlHandler(warehouse));
	return { app, warehouse };
}
const query =
	'query($input:HubbleQueryInput!) { hubbleQuery(input:$input) { dataset columns rows limit offset nextOffset aggregates { alias function field sourceType valueEncoding approximate } coverage { contiguousLastLedger } coverageStatus window { minLedger maxLedger } semantics } }';
describe('shared aggregate GraphQL forwarding', () => {
	it('passes identical normalized query input to REST and GraphQL and preserves exact result strings', async () => {
		const f = fixture();
		const input = {
			dataset: 'history_operations',
			groupBy: ['type'],
			aggregations: [{ function: 'count', alias: 'records' }],
			minLedger: 2,
			maxLedger: 65,
			limit: 2,
			offset: 0,
			filters: [{ field: 'type', operator: 'eq', value: 1 }],
			orderBy: [{ field: 'records', direction: 'desc' }]
		};
		const rest = await request(f.app)
			.post('/v1/analytics/query')
			.send(input)
			.expect(200);
		const gql = await request(f.app)
			.post('/graphql')
			.send({
				query,
				variables: {
					input: {
						...input,
						aggregations: [{ function: 'COUNT', alias: 'records' }],
						filters: [{ field: 'type', operator: 'EQ', value: 1 }],
						orderBy: [{ field: 'records', direction: 'DESC' }]
					}
				}
			})
			.expect(200);
		expect(gql.body.errors).toBeUndefined();
		expect(f.warehouse.query.mock.calls[1]).toEqual(
			f.warehouse.query.mock.calls[0]
		);
		expect(gql.body.data.hubbleQuery).toMatchObject({
			rows: rest.body.rows,
			aggregates: rest.body.aggregates,
			window: rest.body.window,
			coverageStatus: 'complete',
			nextOffset: null,
			semantics: rest.body.semantics
		});
	});
	it.each(['COUNT', 'COUNT_DISTINCT', 'SUM', 'AVG', 'MIN', 'MAX'])(
		'normalizes %s without SQL expressions',
		async (fn) => {
			const f = fixture();
			const result = await request(f.app)
				.post('/graphql')
				.send({
					query,
					variables: {
						input: {
							dataset: 'history_operations',
							minLedger: 2,
							maxLedger: 65,
							aggregations: [{ function: fn, field: 'type', alias: 'metric' }]
						}
					}
				})
				.expect(200);
			expect(result.body.errors).toBeUndefined();
			expect(f.warehouse.query).toHaveBeenCalledWith(
				expect.objectContaining({
					aggregations: [
						{ function: fn.toLowerCase(), field: 'type', alias: 'metric' }
					],
					minLedger: 2,
					maxLedger: 65
				})
			);
		}
	);
	it('rejects unknown functions at schema validation before querying', async () => {
		const f = fixture();
		const result = await request(f.app)
			.post('/graphql')
			.send({
				query,
				variables: {
					input: {
						dataset: 'history_operations',
						aggregations: [{ function: 'RAW_SQL', alias: 'metric' }]
					}
				}
			})
			.expect(200);
		expect(result.body.errors[0].message).toContain('RAW_SQL');
		expect(f.warehouse.query).not.toHaveBeenCalled();
	});
	it('preserves the shared compiler validation error instead of executing a separate GraphQL query path', async () => {
		const f = fixture();
		f.warehouse.query.mockRejectedValue(
			new HubbleWarehouseInputError('Aggregate window required')
		);
		const result = await request(f.app)
			.post('/graphql')
			.send({
				query,
				variables: {
					input: {
						dataset: 'history_operations',
						aggregations: [{ function: 'COUNT', alias: 'records' }]
					}
				}
			})
			.expect(200);
		expect(result.body.errors[0]).toMatchObject({
			message: 'Aggregate window required',
			extensions: { code: 'BAD_USER_INPUT' }
		});
	});
});
