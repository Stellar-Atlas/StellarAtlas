import { Ajv } from 'ajv';
import { withHubbleOpenApiPaths } from '../HubbleOpenApiDocument.js';
import {
	readOpenApiRecord,
	type OpenApiRecord
} from '../OpenApiDocumentProjection.js';
import { hubbleAggregateExample } from '../HubbleAggregateOpenApi.js';
const r = (value: unknown): OpenApiRecord => {
	const result = readOpenApiRecord(value);
	if (!result) throw Error('Expected record');
	return result;
};
const document = withHubbleOpenApiPaths({ openapi: '3.0.3', paths: {} });
const schemas = r(r(document.components).schemas);
function validator(schema: OpenApiRecord) {
	const ajv = new Ajv({ strict: false });
	ajv.addFormat('date-time', (value) => Number.isFinite(Date.parse(value)));
	return ajv.compile({ ...schema, components: { schemas } });
}
function operation(path: string) {
	return r(r(r(document.paths)[path]).post);
}
function body(path: string) {
	return r(r(r(operation(path).requestBody).content)['application/json'])
		.schema as OpenApiRecord;
}
describe('Hubble aggregate OpenAPI contracts', () => {
	it('documents a dataset-specific route with executable bounded aggregate example', () => {
		const path = '/v1/analytics/datasets/{dataset}/query';
		const schema = body(path),
			check = validator(schema);
		expect(check(schema.example)).toBe(true);
		expect(schema.example).not.toHaveProperty('dataset');
		const example = schema.example as Record<string, unknown>;
		expect(check({ ...example, minLedger: undefined })).toBe(false);
		expect(check({ ...example, aggregations: [] })).toBe(false);
		expect(check({ ...example, select: ['type_string'] })).toBe(false);
		expect(
			check({ ...example, aggregations: [{ function: 'raw_sql', alias: 'n' }] })
		).toBe(false);
		expect(check({ select: ['id'], limit: 10 })).toBe(true);
	});
	it('keeps /query raw requests valid and adds strict aggregate request variant', () => {
		const schema = body('/v1/analytics/query'),
			check = validator(schema);
		expect(check(schema.example)).toBe(true);
		expect(check(hubbleAggregateExample)).toBe(true);
		const { dataset: _dataset, ...missing } = hubbleAggregateExample;
		expect(check(missing)).toBe(false);
		expect(check({ ...hubbleAggregateExample, maxLedger: 2147483648 })).toBe(
			false
		);
	});
	it('validates the representative response including precision and coverage', () => {
		const response = r(
			r(operation('/v1/analytics/datasets/{dataset}/query').responses)['200']
		);
		const schema = r(r(r(response.content)['application/json']).schema);
		const check = validator(schema);
		expect(check(schema.example)).toBe(true);
		expect(schema.example).toMatchObject({
			coverageStatus: 'complete',
			window: { minLedger: 63490364, maxLedger: 63490364 },
			aggregates: [{ valueEncoding: 'string-or-null', approximate: false }]
		});
	});
});
