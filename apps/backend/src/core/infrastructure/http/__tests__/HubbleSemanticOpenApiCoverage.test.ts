import { explorerRecordExamples } from '../HubbleExplorerOpenApiExamples.js';
import { Router } from 'express';
import { mock } from 'jest-mock-extended';
import openApiDocument from '../../../../../openapi.json' with { type: 'json' };
import { registerHubbleSemanticRoutes } from '../../../../status/infrastructure/http/HubbleSemanticRoutes.js';
import { registerHubbleExplorerRoutes } from '../../../../status/infrastructure/http/HubbleExplorerRoutes.js';
import { registerHubbleTransferRoutes } from '../../../../status/infrastructure/http/HubbleTransferRoutes.js';
import type { HubbleWarehouse } from '../../../../status/infrastructure/http/HubbleWarehouseContracts.js';
import { createPublicOpenApiDocument } from '../PublicOpenApiDocument.js';
import { readOpenApiRecord as record } from '../OpenApiDocumentProjection.js';

const normalize = (path: string): string =>
	path.replace(/:[^/]+|\{[^}]+\}/g, '{}');
describe('public semantic OpenAPI coverage', () => {
	const document = createPublicOpenApiDocument(openApiDocument);
	const paths = record(document.paths)!;
	it('puts the parsed Analytics section first without changing deep-link tags', () => {
		expect((document.tags as Record<string, unknown>[])[0].name).toBe(
			'Analytics'
		);
	});
	const schemas = record(record(document.components)!.schemas)!;
	it('documents every actual registered semantic, entity and transfer route', () => {
		const router = Router();
		const warehouse = mock<HubbleWarehouse>();
		registerHubbleSemanticRoutes(router, warehouse);
		registerHubbleExplorerRoutes(router, warehouse);
		registerHubbleTransferRoutes(router, warehouse);
		const documented = new Set(Object.keys(paths).map(normalize));
		for (const layer of router.stack as unknown[]) {
			const route = record(record(layer)?.route);
			if (typeof route?.path === 'string') {
				expect(documented.has(normalize('/v1/analytics' + route.path))).toBe(
					true
				);
			}
		}
	});
	it('retains legacy operation IDs and documents typed variants, filters and coverage-aware errors', () => {
		const operations = record(
			record(paths['/v1/analytics/operations/{operationId}'])!.get
		)!;
		expect(operations.operationId).toBe('getAnalyticsOperation');
		expect(JSON.stringify(operations)).toContain('view');
		for (const path of [
			'/v1/analytics/assets/{asset}',
			'/v1/analytics/contracts/{contractId}',
			'/v1/analytics/offers/{offerId}',
			'/v1/analytics/trades/{tradeId}'
		]) {
			const operation = record(record(paths[path])!.get)!;
			expect(record(operation.responses)).toHaveProperty('409');
			expect(operation.security).toEqual([]);
			expect(operation.description).toContain('1000000');
		}
		const list = record(record(paths['/v1/analytics/operations'])!.get)!;
		expect(JSON.stringify(list.parameters)).toContain('invoke_host_function');
		expect(JSON.stringify(schemas.HubbleExplorerTrade)).toContain(
			'source_float64'
		);
		expect(JSON.stringify(schemas.HubbleTransfer)).toContain('amountRaw');
	});
	it('publishes actual GraphQL request examples and resolves every Hubble schema reference', () => {
		const graphql = record(paths['/graphql'])!;
		expect(record(graphql.post)!.operationId).toBe('postAnalyticsGraphql');
		expect(graphql.get).toBeDefined();
		expect(JSON.stringify(graphql)).toContain('hubbleTransaction');
		const visit = (value: unknown): void => {
			if (Array.isArray(value)) {
				value.forEach(visit);
				return;
			}
			const item = record(value);
			if (!item) return;
			if (
				typeof item.$ref === 'string' &&
				item.$ref.startsWith('#/components/schemas/Hubble')
			) {
				expect(schemas[item.$ref.split('/').at(-1)!]).toBeDefined();
			}
			Object.values(item).forEach(visit);
		};
		visit(document);
	});
	it('uses recorded exact identifiers and source amounts with constrained entity schemas', () => {
		for (const [name, example] of [
			['Trade', explorerRecordExamples.trade],
			['Offer', explorerRecordExamples.offer]
		] as const) {
			const schema = record(schemas['HubbleExplorer' + name])!;
			expect(schema.example).toEqual(example);
			const properties = record(schema.properties)!;
			expect(example.id).toMatch(
				new RegExp(String(record(properties.id)!.pattern))
			);
			expect(example.ledgerSequence).toBe(63490364);
			expect(example.amountPrecision).toBe('source_float64');
			expect(typeof example.price.numerator).toBe('string');
		}
		const operation = record(
			record(schemas.HubbleExplorerOperation)!.properties
		)!;
		expect(record(operation.id)!.example).toBe('272689036992143361');
		expect(record(operation.transactionHash)!.example).toBe(
			explorerRecordExamples.operation.transactionHash
		);
	});
	it('distinguishes legacy and typed trade filters and documents query failures', () => {
		const trade = record(record(paths['/v1/analytics/trades'])!.get)!;
		const parameters = trade.parameters as Record<string, unknown>[];
		expect(
			parameters.find((item) => item.name === 'selling_asset_code')?.description
		).toContain('Legacy only');
		expect(
			parameters.find((item) => item.name === 'selling_asset')?.description
		).toContain('Typed only');
		expect(
			parameters.find((item) => item.name === 'seller')?.description
		).toContain('both views');
		const minimum = parameters.find((item) => item.name === 'min_ledger')!;
		expect(record(minimum.schema)!.minimum).toBe(1);
		expect(record(trade.responses)).toHaveProperty('500');
		const transaction = record(
			record(paths['/v1/analytics/transactions/{transactionHash}'])!.get
		)!;
		expect(record(transaction.responses)).toHaveProperty('500');
	});
});
