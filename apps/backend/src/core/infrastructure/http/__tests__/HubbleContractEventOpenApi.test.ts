import express from 'express';
import request from 'supertest';
import { mock } from 'jest-mock-extended';
import {
	buildClientSchema,
	getIntrospectionQuery,
	parse,
	validate,
	type IntrospectionQuery
} from 'graphql';
import { withHubbleOpenApiPaths } from '../HubbleOpenApiDocument.js';
import {
	readOpenApiRecord,
	type OpenApiRecord
} from '../OpenApiDocumentProjection.js';
import { hubbleWarehouseGraphqlHandler } from '../../../../status/infrastructure/http/HubbleWarehouseGraphql.js';
import { normalizeHubbleContractEventInput } from '../../../../status/infrastructure/http/HubbleContractEventValidation.js';
import type { HubbleWarehouse } from '../../../../status/infrastructure/http/HubbleWarehouseContracts.js';

function record(value: unknown): OpenApiRecord {
	const result = readOpenApiRecord(value);
	if (result === null) throw new Error('Expected OpenAPI object');
	return result;
}
function list(value: unknown): unknown[] {
	if (!Array.isArray(value)) throw new Error('Expected OpenAPI array');
	return value;
}
function jsonSchema(operation: OpenApiRecord, code = '200'): OpenApiRecord {
	const response = record(record(operation.responses)[code]);
	return record(record(record(response.content)['application/json']).schema);
}

describe('typed contract-event OpenAPI', () => {
	const document = withHubbleOpenApiPaths({ openapi: '3.0.3', paths: {} });
	const paths = record(document.paths);
	const operation = record(
		record(paths['/v1/analytics/contracts/{contractId}/events']).get
	);
	const parameters = list(operation.parameters).map(record);
	const schemas = record(record(document.components).schemas);

	it('retains the existing operation and legacy offset shape alongside the opt-in typed response', () => {
		expect(operation.operationId).toBe('listAnalyticsContractEvents');
		expect(operation.security).toEqual([]);
		expect(jsonSchema(operation).oneOf).toEqual([
			{ $ref: '#/components/schemas/HubbleContractEventPage' },
			{ $ref: '#/components/schemas/HubbleTypedContractEventPage' }
		]);
		const legacy = record(record(schemas.HubbleContractEventPage).properties);
		expect(legacy).toHaveProperty('rows');
		expect(legacy).toHaveProperty('offset');
		expect(legacy).toHaveProperty('nextOffset');
		expect(legacy).not.toHaveProperty('items');
		expect(operation.description).toContain('Omit view');
	});

	it('documents every accepted typed filter once and does not inject a forbidden offset into Try it out', () => {
		const names = parameters.map((parameter) => parameter.name);
		expect(names).toHaveLength(new Set(names).size);
		expect(names).toEqual(
			expect.arrayContaining([
				'contractId',
				'view',
				'transaction_hash',
				'min_ledger',
				'max_ledger',
				'start_time',
				'end_time',
				'type_code',
				'successful',
				'in_successful_contract_call',
				'limit',
				'after',
				'offset'
			])
		);
		const parameter = (name: string): OpenApiRecord =>
			parameters.find((item) => item.name === name)!;
		expect(record(parameter('view').schema).enum).toEqual(['typed']);
		expect(parameter('view').required).toBe(false);
		expect(record(parameter('type_code').schema).enum).toEqual([0, 1, 2]);
		expect(record(parameter('successful').schema).type).toBe('boolean');
		expect(record(parameter('in_successful_contract_call').schema).type).toBe(
			'boolean'
		);
		expect(parameter('start_time').description).toContain('Inclusive UTC');
		expect(parameter('end_time').description).toContain('Exclusive UTC');
		expect(record(parameter('after').schema)).toMatchObject({
			minLength: 1,
			maxLength: 2048
		});
		expect(record(parameter('offset').schema)).not.toHaveProperty('default');
		expect(parameter('offset').description).toContain(
			'Must be omitted for view=typed'
		);
		const contractId = String(record(parameter('contractId').schema).example);
		const defaults = normalizeHubbleContractEventInput({ contractId });
		expect(record(parameter('limit').schema)).toMatchObject({
			minimum: 1,
			maximum: 200,
			default: defaults.limit
		});
		expect(parameter('min_ledger').description).toContain('1000000');
		expect(parameter('min_ledger').description).toContain('100000');
	});

	it('publishes exact event fields and required coverage without claiming a frozen snapshot', () => {
		const page = record(schemas.HubbleTypedContractEventPage);
		const fields = record(page.properties);
		expect(page.required).toEqual([
			'contractId',
			'items',
			'limit',
			'nextCursor',
			'watermark',
			'coverage',
			'elapsedMilliseconds'
		]);
		const event = record(record(fields.items).items);
		const eventFields = record(event.properties);
		for (const name of [
			'id',
			'transactionId',
			'transactionHash',
			'topicsJson',
			'dataJson',
			'eventXdr'
		])
			expect(record(eventFields[name]).type).toBe('string');
		expect(record(eventFields.operationId).nullable).toBe(true);
		expect(record(eventFields.closedAt).format).toBe('date-time');
		expect(record(eventFields.successful).type).toBe('boolean');
		expect(record(eventFields.inSuccessfulContractCall).type).toBe('boolean');
		expect(record(fields.nextCursor).nullable).toBe(true);
		expect(fields.coverage).toEqual(schemas.HubbleLedgerCoverage);
		const transaction = record(
			record(schemas.HubbleTypedTransaction).properties
		);
		const transactionEvents = record(record(transaction.events).properties);
		expect(record(transactionEvents.items).items).toEqual(event);
		expect(operation.description).toContain('not a frozen snapshot');
		expect(operation.description).toContain('Only completed ingestion batches');
		expect(operation.description).toContain('does not imply success');
		for (const code of ['400', '500', '503'])
			expect(record(operation.responses)).toHaveProperty(code);
	});

	it('validates every published GraphQL example against the actual read-only handler schema', async () => {
		const warehouse = mock<HubbleWarehouse>();
		const app = express();
		app.use(express.json());
		app.all('/graphql', hubbleWarehouseGraphqlHandler(warehouse));
		const response = await request(app)
			.post('/graphql')
			.send({ query: getIntrospectionQuery() })
			.expect(200);
		const body = record(response.body);
		expect(body.errors).toBeUndefined();
		const schema = buildClientSchema(body.data as IntrospectionQuery);
		const graphql = record(record(paths['/graphql']).post);
		const content = record(record(graphql.requestBody).content);
		const examples = record(record(content['application/json']).examples);
		expect(examples).toHaveProperty('contractEvents');
		expect(examples).toHaveProperty('trades');
		expect(examples).toHaveProperty('offers');
		for (const [name, example] of Object.entries(examples)) {
			const value = record(record(example).value);
			expect(typeof value.query).toBe('string');
			const errors = validate(schema, parse(String(value.query)));
			expect({
				example: name,
				errors: errors.map((error) => error.message)
			}).toEqual({ example: name, errors: [] });
		}
		expect(schema.getMutationType()).toBeNull();
		expect(warehouse.contractEvents).not.toHaveBeenCalled();
		expect(warehouse.catalog).not.toHaveBeenCalled();
	});
});
