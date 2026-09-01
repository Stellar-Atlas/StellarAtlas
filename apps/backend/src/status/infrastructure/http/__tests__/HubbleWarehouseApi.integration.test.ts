import express from 'express';
import request from 'supertest';
import type {
	HubbleCatalog,
	HubbleQueryResult,
	HubbleWarehouse
} from '../HubbleWarehouseClient.js';
import { hubbleWarehouseGraphqlHandler } from '../HubbleWarehouseGraphql.js';
import { hubbleWarehouseRouter } from '../HubbleWarehouseRouter.js';

const catalog: HubbleCatalog = {
	database: 'stellar_hubble',
	datasets: [
		{
			columns: [
				{ name: 'id', position: 1, type: 'String' },
				{ name: 'ledger_sequence', position: 2, type: 'UInt32' },
				{ name: 'source_account', position: 3, type: 'String' }
			],
			name: 'history_transactions',
			rowCount: '123'
		}
	],
	generatedAt: '2026-08-31T20:00:00.000Z',
	ingestion: {
		completedBatches: '2',
		failedBatches: '0',
		maximumLedger: '66',
		minimumLedger: '2',
		startedBatches: '0',
		totalRows: '87'
	},
	officialSchemaSource:
		'github.com/stellar/stellar-etl/v2/internal/transform@v2.8.23'
};

const result: HubbleQueryResult = {
	columns: ['id', 'ledger_sequence'],
	dataset: 'history_transactions',
	elapsedMilliseconds: 1.25,
	limit: 50,
	offset: 0,
	rows: [{ id: 'transaction-1', ledger_sequence: 3 }]
};

describe('HubbleWarehouseRouter.integration', () => {
	it('maps dynamic resource filters to one shared warehouse query', async () => {
		const warehouse = mockWarehouse();
		await request(buildRestApp(warehouse))
			.get(
				'/v1/analytics/history_transactions' +
					'?source_account=GABC' +
					'&ledger_sequence__gte=3' +
					'&select=id,ledger_sequence' +
					'&order=-ledger_sequence' +
					'&limit=50'
			)
			.expect(200)
			.expect((response) => {
				expect(response.body.rows).toEqual([
					{ id: 'transaction-1', ledger_sequence: 3 }
				]);
			});
		expect(warehouse.query).toHaveBeenCalledWith({
			dataset: 'history_transactions',
			filters: [
				{ field: 'source_account', operator: 'eq', value: 'GABC' },
				{ field: 'ledger_sequence', operator: 'gte', value: '3' }
			],
			limit: 50,
			offset: undefined,
			orderBy: [{ direction: 'desc', field: 'ledger_sequence' }],
			select: ['id', 'ledger_sequence']
		});
	});

	it('serves the ClickHouse-owned dataset catalog', async () => {
		const warehouse = mockWarehouse();
		await request(buildRestApp(warehouse))
			.get('/v1/analytics/datasets')
			.expect(200)
			.expect((response) => {
				expect(response.body.datasets[0]).toMatchObject({
					name: 'history_transactions',
					rowCount: '123'
				});
				expect(response.body.ingestion.completedBatches).toBe('2');
			});
	});
});

describe('HubbleWarehouseGraphql.integration', () => {
	it('returns real warehouse status and structured JSON rows', async () => {
		const warehouse = mockWarehouse();
		await request(buildGraphqlApp(warehouse))
			.post('/graphql')
			.send({
				query: `
					query Hubble($input: HubbleQueryInput!) {
						hubbleStatus {
							compatibility
							completedBatches
							datasetCount
							maximumLedger
							servingWarehouse
						}
						hubbleQuery(input: $input) {
							dataset
							columns
							rows
						}
					}
				`,
				variables: {
					input: {
						dataset: 'history_transactions',
						filters: [
							{
								field: 'ledger_sequence',
								operator: 'GTE',
								value: 3
							}
						],
						limit: 50,
						select: ['id', 'ledger_sequence']
					}
				}
			})
			.expect(200)
			.expect((response) => {
				expect(response.body.errors).toBeUndefined();
				expect(response.body.data.hubbleStatus).toEqual({
					compatibility: 'official-stellar-etl-schema',
					completedBatches: '2',
					datasetCount: 1,
					maximumLedger: '66',
					servingWarehouse: 'ClickHouse'
				});
				expect(response.body.data.hubbleQuery.rows).toEqual([
					{ id: 'transaction-1', ledger_sequence: 3 }
				]);
			});
		expect(warehouse.query).toHaveBeenCalledWith({
			dataset: 'history_transactions',
			filters: [
				{
					field: 'ledger_sequence',
					operator: 'gte',
					value: 3,
					values: undefined
				}
			],
			limit: 50,
			offset: undefined,
			orderBy: undefined,
			select: ['id', 'ledger_sequence']
		});
	});
});

function mockWarehouse(): HubbleWarehouse & {
	catalog: jest.Mock;
	query: jest.Mock;
} {
	return {
		catalog: jest.fn().mockResolvedValue(catalog),
		query: jest.fn().mockResolvedValue(result)
	};
}

function buildRestApp(warehouse: HubbleWarehouse): express.Application {
	const app = express();
	app.use(express.json());
	app.use('/v1/analytics', hubbleWarehouseRouter({ warehouse }));
	return app;
}

function buildGraphqlApp(warehouse: HubbleWarehouse): express.Application {
	const app = express();
	app.use(express.json());
	app.all('/graphql', hubbleWarehouseGraphqlHandler(warehouse));
	return app;
}
