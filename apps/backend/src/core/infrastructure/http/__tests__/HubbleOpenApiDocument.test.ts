import { withHubbleOpenApiPaths } from '../HubbleOpenApiDocument.js';
import { createPublicOpenApiDocument } from '../PublicOpenApiDocument.js';
import { hubbleCoverageSchema } from '../HubbleOpenApiSchemas.js';
import express from 'express';
import request from 'supertest';
import {
	hubbleWarehouseRouter,
	registerHubbleDatasetRoutes
} from '../../../../status/infrastructure/http/HubbleWarehouseRouter.js';
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
	it('matches the dataset-detail and schema routes with catalog coverage', async () => {
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
			accountBalances: unused,
			query: unused
		};
		const app = express();
		const datasetRouter = express.Router();
		registerHubbleDatasetRoutes(datasetRouter, warehouse);
		app.use('/v1', datasetRouter);
		app.use('/v1/analytics', hubbleWarehouseRouter({ warehouse }));
		const datasets = await request(app).get('/v1/datasets').expect(200);
		expect(datasets.body).toEqual(catalog);
		const compatibilityDetail = await request(app)
			.get('/v1/datasets/history_transactions')
			.expect(200);
		const schemaReply = await request(app)
			.get('/v1/datasets/history_transactions/schema')
			.expect(200);
		expect(schemaReply.body).toEqual({
			dataset: 'history_transactions',
			columns: catalog.datasets[0].columns,
			officialSchemaSource: catalog.officialSchemaSource
		});
		expect(schemaReply.headers['cache-control']).toBe('public, max-age=10');
		await request(app).get('/v1/datasets/unknown/schema').expect(400);
		const response = await request(app)
			.get('/v1/analytics/datasets/history_transactions')
			.expect(200);
		expect(response.body).toEqual(compatibilityDetail.body);
		expect(response.body).toEqual({
			database: catalog.database,
			dataset: catalog.datasets[0],
			generatedAt: catalog.generatedAt,
			ingestion: catalog.ingestion,
			coverage: catalog.coverage,
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
		expect(properties.coverage).toBeDefined();
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
		const query = jest.spyOn(warehouse, 'query');
		query.mockResolvedValue({
			columns: ['id'],
			dataset: 'history_transactions',
			elapsedMilliseconds: 1,
			limit: 2,
			offset: 0,
			rows: [{ id: '1' }, { id: '2' }]
		});
		await request(app)
			.get('/v1/datasets/history_transactions/records?limit=2')
			.expect(200)
			.expect(({ body }) => expect(body.nextOffset).toBe(2));
		query.mockResolvedValue({
			columns: ['id'],
			dataset: 'history_transactions',
			elapsedMilliseconds: 1,
			limit: 2,
			offset: 2,
			rows: []
		});
		await request(app)
			.get('/v1/datasets/history_transactions/records?limit=2&offset=2')
			.expect(200)
			.expect(({ body }) => expect(body.nextOffset).toBeNull());
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
	it('publishes the implemented balance and trustline snapshot shapes in the public document', () => {
		const publicDocument = createPublicOpenApiDocument({
			info: { title: 'test', version: '1' },
			openapi: '3.0.3',
			paths: {}
		});
		const publicPaths = readOpenApiRecord(publicDocument.paths)!;
		const expected = {
			'/v1/assets/{asset}/balances': 'listAssetBalancesSnapshot',
			'/v1/assets/{asset}/trustlines': 'listAssetTrustlinesSnapshot',
			'/v1/analytics/assets/{asset}/balances':
				'listAnalyticsAssetBalancesSnapshot',
			'/v1/analytics/assets/{asset}/trustlines':
				'listAnalyticsAssetTrustlinesSnapshot'
		};
		for (const [path, operationId] of Object.entries(expected)) {
			const pathItem = readOpenApiRecord(publicPaths[path])!;
			const operation = readOpenApiRecord(pathItem.get)!;
			expect(operation.operationId).toBe(operationId);
		}
		const balances = readOpenApiRecord(
			readOpenApiRecord(publicPaths['/v1/assets/{asset}/balances'])!.get
		)!;
		const parameters = balances.parameters as Array<Record<string, unknown>>;
		expect(parameters.map((parameter) => parameter.name)).toEqual(
			expect.arrayContaining([
				'account',
				'after',
				'limit',
				'sort',
				'order',
				'as_of_ledger',
				'include_deleted'
			])
		);
		const responses = readOpenApiRecord(balances.responses)!;
		const success = readOpenApiRecord(responses['200'])!;
		const content = readOpenApiRecord(success.content)!;
		const json = readOpenApiRecord(content['application/json'])!;
		const schema = readOpenApiRecord(json.schema)!;
		const properties = readOpenApiRecord(schema.properties)!;
		expect(properties).toHaveProperty('holders');
		expect(properties).toHaveProperty('coverage');
		expect(properties).toHaveProperty('watermark');
		expect(properties).toHaveProperty('indexedSummary');
		expect(properties).toHaveProperty('dataset');
		const trustlines = readOpenApiRecord(
			readOpenApiRecord(publicPaths['/v1/assets/{asset}/trustlines'])!.get
		)!;
		const trustlineResponses = readOpenApiRecord(trustlines.responses)!;
		expect(readOpenApiRecord(trustlineResponses['400'])!.description).toContain(
			'native'
		);
	});
});
