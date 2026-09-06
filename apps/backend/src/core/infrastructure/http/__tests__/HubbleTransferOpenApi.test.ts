import { withHubbleOpenApiPaths } from '../HubbleOpenApiDocument.js';
import { readOpenApiRecord } from '../OpenApiDocumentProjection.js';

describe('typed transfer OpenAPI contract', () => {
	it('publishes executable additive routes with exact strings, dates, and cursor parameters', () => {
		const document = withHubbleOpenApiPaths({ openapi: '3.0.3', paths: {} });
		const paths = readOpenApiRecord(document.paths)!;
		for (const path of [
			'/v1/analytics/activity/transfers',
			'/v1/analytics/accounts/{account}/activity/transfers',
			'/v1/analytics/assets/{asset}/activity/transfers'
		]) {
			const operation = readOpenApiRecord(readOpenApiRecord(paths[path])!.get)!;
			const parameters = operation.parameters as { name: string }[];
			expect(parameters.map((parameter) => parameter.name)).toEqual(
				expect.arrayContaining([
					'amount_raw',
					'min_amount_raw',
					'max_amount_raw',
					'start_time',
					'end_time',
					'min_ledger',
					'max_ledger',
					'after',
					'event_topic'
				])
			);
			expect(operation.security).toEqual([]);
			expect(operation.description).toContain('NOT frozen');
			expect(operation.description).toContain('100000');
			const responses = readOpenApiRecord(operation.responses)!;
			const content = readOpenApiRecord(
				readOpenApiRecord(responses['200'])!.content
			)!;
			const schema = readOpenApiRecord(
				readOpenApiRecord(content['application/json'])!.schema
			)!;
			const components = readOpenApiRecord(readOpenApiRecord(document.components)!.schemas)!;
			const pageSchema = typeof schema.$ref === 'string'
				? readOpenApiRecord(components[schema.$ref.split('/').at(-1)!])!
				: schema;
			const properties = readOpenApiRecord(pageSchema.properties)!;
			const items = readOpenApiRecord(
				readOpenApiRecord(properties.transfers)!.items
			)!;
			const itemSchema = typeof items.$ref === 'string'
				? readOpenApiRecord(components[items.$ref.split('/').at(-1)!])!
				: items;
			const transferProperties = readOpenApiRecord(itemSchema.properties)!;
			expect(readOpenApiRecord(transferProperties.amountRaw)!.type).toBe(
				'string'
			);
			expect(readOpenApiRecord(transferProperties.transactionId)!.type).toBe(
				'string'
			);
			expect(readOpenApiRecord(transferProperties.closedAt)!.format).toBe(
				'date-time'
			);
		}
	});
});
