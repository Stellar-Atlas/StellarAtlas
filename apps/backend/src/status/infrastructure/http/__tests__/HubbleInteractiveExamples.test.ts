import express from 'express';
import request from 'supertest';
import { mock } from 'jest-mock-extended';
import {
	buildClientSchema,
	getIntrospectionQuery,
	getOperationAST,
	getVariableValues,
	parse,
	validate
} from 'graphql';
import { hubbleWarehouseGraphqlHandler } from '../HubbleWarehouseGraphql.js';
import type { HubbleWarehouse } from '../HubbleWarehouseContracts.js';
import { graphqlExamples } from '../../../../../../frontend-v4/src/components/docs/graphql-request.js';

describe('interactive docs examples against the actual GraphQL handler schema', () => {
	it('accepts every example selection and variable shape without querying historical data', async () => {
		const warehouse = mock<HubbleWarehouse>();
		const app = express();
		app.use(express.json());
		app.all('/graphql', hubbleWarehouseGraphqlHandler(warehouse));
		const response = await request(app)
			.post('/graphql')
			.send({ query: getIntrospectionQuery() })
			.expect(200);
		expect(response.body.errors).toBeUndefined();
		const schema = buildClientSchema(response.body.data);
		for (const [name, example] of Object.entries(graphqlExamples)) {
			const document = parse(example.query);
			expect({
				name,
				errors: validate(schema, document).map((error) => error.message)
			}).toEqual({ name, errors: [] });
			const operation = getOperationAST(document);
			expect(operation?.operation).toBe('query');
			const variables = getVariableValues(
				schema,
				operation?.variableDefinitions ?? [],
				example.variables
			);
			expect({
				name,
				errors: variables.errors?.map((error) => error.message) ?? []
			}).toEqual({ name, errors: [] });
		}
		expect(warehouse.query).not.toHaveBeenCalled();
		expect(warehouse.catalog).not.toHaveBeenCalled();
		expect(warehouse.assetHolders).not.toHaveBeenCalled();
		expect(warehouse.accountBalances).not.toHaveBeenCalled();
	});
});
