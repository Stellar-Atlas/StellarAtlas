import { withHubbleOpenApiPaths } from '../HubbleOpenApiDocument.js';
import { hubbleCoverageSchema } from '../HubbleOpenApiSchemas.js';
import express from 'express';
import request from 'supertest';
import { hubbleWarehouseRouter } from '../../../../status/infrastructure/http/HubbleWarehouseRouter.js';
import { summarizeHubbleLedgerCoverage } from '../../../../status/infrastructure/http/HubbleLedgerCoverage.js';
import type {
	HubbleCatalog,
	HubbleWarehouse
} from '../../../../status/infrastructure/http/HubbleWarehouseContracts.js';
import { readOpenApiRecord } from '../OpenApiDocumentProjection.js';

describe('Hubble OpenAPI paths', () => {
	const document = withHubbleOpenApiPaths({
		info: { title: 'test', version: '1' },
		openapi: '3.0.3',
		paths: {}
	});
	const paths = document.paths as Record<
		string,
		Record<string, Record<string, unknown>>
	>;
	it('matches the actual dataset-detail wrapper without promising an absent coverage field', async () => {
		const catalog: HubbleCatalog = {
			database: 'stellar_hubble',
			coverage: summarizeHubbleLedgerCoverage([
				{ start_ledger: 2, end_ledger: 66 }
			]),
			datasets: [
				{
					columns: [{ name: 'id', position: 1, type: 'String' }],
					name: 'history_transactions',
					rowCount: '123'
				}
			],
			generatedAt: '2026-09-07T00:00:00.000Z',
			ingestion: {
				completedBatches: '2',
				failedBatches: '0',
				maximumLedger: '66',
				minimumLedger: '2',
				startedBatches: '0',
				totalRows: '123'
			},
			officialSchemaSource: 'stellar/stellar-etl'
		};
		const unused = async (): Promise<never> => {
			throw new Error('Unexpected warehouse query');
		};
		const warehouse: HubbleWarehouse = {
			catalog: async () => catalog,
			contractEvents: unused,
			transactionDetail: unused,
			transferActivity: unused,
			classifyEventRows: unused,
			accountTransactions: unused,
			assetHolders: unused,
			query: unused
		};
		const app = express();
		app.use('/v1/analytics', hubbleWarehouseRouter({ warehouse }));
		const response = await request(app)
			.get('/v1/analytics/datasets/history_transactions')
			.expect(200);
		expect(response.body).toEqual({
			database: catalog.database,
			dataset: catalog.datasets[0],
			generatedAt: catalog.generatedAt,
			ingestion: catalog.ingestion,
			officialSchemaSource: catalog.officialSchemaSource
		});
		const operation = paths['/v1/analytics/datasets/{dataset}']!.get!;
		const responses = readOpenApiRecord(operation.responses)!;
		const success = readOpenApiRecord(responses['200'])!;
		const content = readOpenApiRecord(success.content)!;
		const json = readOpenApiRecord(content['application/json'])!;
		const schema = readOpenApiRecord(json.schema)!;
		const properties = readOpenApiRecord(schema.properties)!;
		expect(schema.type).toBe('object');
		expect(schema.additionalProperties).toBe(false);
		expect(schema.required).toEqual(Object.keys(response.body));
		expect(Object.keys(properties)).toEqual(Object.keys(response.body));
		expect(properties).not.toHaveProperty('coverage');
		expect(properties.dataset).toMatchObject({
			type: 'object',
			required: ['columns', 'name', 'rowCount']
		});
		const ingestion = readOpenApiRecord(properties.ingestion)!;
		expect(ingestion.required).toEqual(Object.keys(catalog.ingestion));
		expect(Object.keys(readOpenApiRecord(ingestion.properties)!)).toEqual(
			Object.keys(catalog.ingestion)
		);
		expect(success.description).toBe(
			'Hubble dataset schema with warehouse and ingestion metadata.'
		);
	});

	it('documents optional merged completed intervals without changing legacy required fields', () => {
		expect(hubbleCoverageSchema.required).not.toContain('completedRanges');
		expect(hubbleCoverageSchema.properties).toMatchObject({
			completedRanges: {
				type: 'array',
				items: {
					type: 'object',
					required: ['firstLedger', 'lastLedger'],
					properties: {
						firstLedger: { type: 'string' },
						lastLedger: { type: 'string' }
					}
				}
			}
		});
	});

	it('documents the semantic history and Soroban query surface', () => {
		expect(
			paths['/v1/analytics/transactions/{transactionHash}']?.get?.operationId
		).toBe('getAnalyticsTransaction');
		expect(paths['/v1/analytics/ledgers/{sequence}']?.get?.operationId).toBe(
			'getAnalyticsLedger'
		);
		expect(
			paths['/v1/analytics/ledgers/{sequence}/transactions']?.get?.operationId
		).toBe('listAnalyticsLedgerTransactions');
		expect(
			paths['/v1/analytics/operations/{operationId}']?.get?.operationId
		).toBe('getAnalyticsOperation');
		expect(
			paths['/v1/analytics/operations/{operationId}/effects']?.get?.operationId
		).toBe('listAnalyticsOperationEffects');
		expect(
			paths['/v1/analytics/accounts/{account}/effects']?.get?.operationId
		).toBe('listAnalyticsAccountEffects');
		expect(paths['/v1/analytics/trades']?.get?.operationId).toBe(
			'searchAnalyticsTrades'
		);
		expect(
			paths['/v1/analytics/assets/{asset}/transfers']?.get?.operationId
		).toBe('listAnalyticsAssetTransfers');
		expect(
			paths['/v1/analytics/contracts/{contractId}/state']?.get?.operationId
		).toBe('listAnalyticsContractState');
	});

	it('keeps every analytics operation public', () => {
		for (const [path, pathItem] of Object.entries(paths)) {
			if (!path.startsWith('/v1/analytics')) continue;
			for (const operation of Object.values(pathItem)) {
				expect(operation.security).toEqual([]);
			}
		}
	});
});
