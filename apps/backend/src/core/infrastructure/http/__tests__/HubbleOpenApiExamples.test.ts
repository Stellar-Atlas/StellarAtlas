import { Ajv } from 'ajv';
import { withHubbleOpenApiPaths } from '../HubbleOpenApiDocument.js';
import {
	readOpenApiRecord,
	type OpenApiRecord
} from '../OpenApiDocumentProjection.js';
import { exactInteger, hubbleCoverageSchema } from '../HubbleOpenApiSchemas.js';
import { hubbleSemanticSchemas } from '../HubbleSemanticOpenApiSchemas.js';
import {
	hubbleCoverageExample,
	hubbleLedgerExample
} from '../HubbleOpenApiExamples.js';
import { summarizeHubbleLedgerCoverage } from '../../../../status/infrastructure/http/HubbleLedgerCoverage.js';

const document = withHubbleOpenApiPaths({ openapi: '3.0.3', paths: {} });
const schemas = readOpenApiRecord(
	readOpenApiRecord(document.components)!.schemas
)!;
function validate(schema: OpenApiRecord, value: unknown): boolean {
	const ajv = new Ajv({ strict: false });
	ajv.addFormat('date-time', (value) => Number.isFinite(Date.parse(value)));
	const check = ajv.compile({ ...schema, components: { schemas } });
	return check(value) as boolean;
}
function responseSchema(path: string): OpenApiRecord {
	const paths = readOpenApiRecord(document.paths)!;
	const operation = readOpenApiRecord(readOpenApiRecord(paths[path])!.get)!;
	const response = readOpenApiRecord(
		readOpenApiRecord(operation.responses)!['200']
	)!;
	const content = readOpenApiRecord(
		readOpenApiRecord(response.content)!['application/json']
	)!;
	return readOpenApiRecord(content.schema)!;
}
describe('deterministic representative Hubble OpenAPI examples', () => {
	it('publishes coherent ledger counts and completed ranges rather than generated signed numbers', () => {
		expect(hubbleCoverageExample).toEqual(
			summarizeHubbleLedgerCoverage(
				hubbleCoverageExample.completedRanges.map((range) => ({
					start_ledger: range.firstLedger,
					end_ledger: range.lastLedger
				}))
			)
		);
		expect(validate(hubbleCoverageSchema, hubbleCoverageExample)).toBe(true);
		expect(hubbleCoverageSchema.example).toEqual(hubbleCoverageExample);
		expect(hubbleCoverageSchema.description).toContain(
			'not a current coverage'
		);
		const properties = readOpenApiRecord(hubbleCoverageSchema.properties)!;
		for (const name of Object.keys(hubbleCoverageExample).filter(
			(key) => key !== 'completedRanges'
		)) {
			const property = readOpenApiRecord(properties[name])!;
			expect(property).toHaveProperty('example');
			const negative = name === 'gapCount' ? -1 : '-1';
			expect(
				validate(hubbleCoverageSchema, {
					...hubbleCoverageExample,
					[name]: negative
				})
			).toBe(false);
		}
	});
	it('retains valid empty coverage and signed values where genuinely supported', () => {
		expect(
			validate(hubbleCoverageSchema, summarizeHubbleLedgerCoverage([]))
		).toBe(true);
		expect(validate(exactInteger, '-10000000')).toBe(true);
		expect(exactInteger.example).toBe('123');
	});
	it('uses realistic unsigned source ledger and count examples without upgrading Float64 precision', () => {
		const schema = hubbleSemanticSchemas.HubbleLedgerRecord!;
		expect(validate(schema, hubbleLedgerExample)).toBe(true);
		expect(schema.example).toEqual(hubbleLedgerExample);
		expect(schema.description).toContain('placeholders');
		for (const [field, value] of [
			['sequence', -1],
			['sequence', 4294967296],
			['transaction_count', '-2'],
			['operation_count', -3]
		] as const)
			expect(validate(schema, { ...hubbleLedgerExample, [field]: value })).toBe(
				false
			);
		const holder = readOpenApiRecord(
			hubbleSemanticSchemas.HubbleHolder!.properties
		)!;
		expect(readOpenApiRecord(holder.balance)!.oneOf).toEqual([
			{ type: 'string' },
			{ type: 'number' }
		]);
	});
	it('validates catalog, dataset detail and query response examples against their actual published wrappers', () => {
		for (const path of [
			'/v1/analytics/datasets',
			'/v1/analytics/datasets/{dataset}',
			'/v1/analytics/{dataset}'
		]) {
			const schema = responseSchema(path);
			expect(schema.example).toBeDefined();
			expect(validate(schema, schema.example)).toBe(true);
			expect(schema.description).toContain('Representative');
		}
		const catalog = responseSchema('/v1/analytics/datasets');
		const detail = responseSchema('/v1/analytics/datasets/{dataset}');
		expect(readOpenApiRecord(catalog.properties)!.ingestion).toEqual(
			readOpenApiRecord(detail.properties)!.ingestion
		);
		expect(readOpenApiRecord(detail.properties)).not.toHaveProperty('coverage');
	});
	it('prepopulates a valid bounded one-ledger structured query instead of string placeholders', () => {
		const paths = readOpenApiRecord(document.paths)!;
		const operation = readOpenApiRecord(
			readOpenApiRecord(paths['/v1/analytics/query'])!.post
		)!;
		const body = readOpenApiRecord(operation.requestBody)!;
		const content = readOpenApiRecord(
			readOpenApiRecord(body.content)!['application/json']
		)!;
		const schema = readOpenApiRecord(content.schema)!;
		expect(validate(schema, schema.example)).toBe(true);
		expect(schema.example).toMatchObject({
			dataset: 'history_transactions',
			limit: 10,
			offset: 0,
			filters: [{ field: 'ledger_sequence', operator: 'eq', value: 63490364 }]
		});
	});
	it('describes coverage of completed supplemental windows without claiming global completeness', () => {
		const properties = readOpenApiRecord(
			readOpenApiRecord(schemas.HubbleExplorerOperationPage)!.properties
		)!;
		expect(readOpenApiRecord(properties.coverageStatus)!.description).toContain(
			'including supplemental intervals'
		);
		expect(readOpenApiRecord(properties.coverageStatus)!.description).toContain(
			'gaps outside that window'
		);
	});
});
