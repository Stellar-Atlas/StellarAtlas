import {
	buildSchema,
	parse,
	validate,
	specifiedRules,
	getIntrospectionQuery
} from 'graphql';
import { validateHubbleGraphqlBudget } from '../HubbleGraphqlBudget.js';
const schema = buildSchema(
	'type Query { hubbleQuery: Result hubbleDatasets: [Result!]! } type Result { value: String nested: Result }'
);
const check = (query: string) =>
	validate(schema, parse(query), [
		...specifiedRules,
		validateHubbleGraphqlBudget
	]);
describe('analytics GraphQL request-wide budget', () => {
	it('allows the standard schema introspection used by GraphiQL', () =>
		expect(check(getIntrospectionQuery())).toEqual([]));
	it('allows four data query roots but rejects alias fanout before resolvers', () => {
		expect(
			check(
				'{a:hubbleQuery{value} b:hubbleQuery{value} c:hubbleQuery{value} d:hubbleQuery{value}}'
			)
		).toEqual([]);
		expect(
			check(
				'{a:hubbleQuery{value} b:hubbleQuery{value} c:hubbleQuery{value} d:hubbleQuery{value} e:hubbleQuery{value}}'
			).some((error) => error.extensions.code === 'QUERY_TOO_COMPLEX')
		).toBe(true);
	});
	it('counts root work inside repeated fragments and inline fragments', () => {
		const query =
			'query{...A ... on Query{e:hubbleQuery{value}}} fragment A on Query{a:hubbleQuery{value} b:hubbleQuery{value} c:hubbleQuery{value} d:hubbleQuery{value}}';
		expect(
			check(query).some(
				(error) => error.extensions.code === 'QUERY_TOO_COMPLEX'
			)
		).toBe(true);
	});
	it('limits expanded depth and handles cycles without recursion overflow', () => {
		expect(
			check(
				'{hubbleQuery{' + 'nested{'.repeat(35) + 'value' + '}'.repeat(35) + '}}'
			).some((error) => error.extensions.code === 'QUERY_TOO_COMPLEX')
		).toBe(true);
		expect(
			check('query{...A} fragment A on Query{...A}').length
		).toBeGreaterThan(0);
	});
});
