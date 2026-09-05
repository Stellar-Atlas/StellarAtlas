import {
	graphqlPageVariables,
	parseGraphqlVariables
} from '../graphql-request';

describe('GraphQL documentation requests', () => {
	const variables = JSON.stringify({
		input: {
			dataset: 'history_ledgers',
			limit: 2,
			offset: 0,
			filters: [{ field: 'sequence', value: 3 }]
		}
	});
	const result = {
		data: { hubbleQuery: { limit: 2, offset: 0, rows: [{}, {}] } }
	};

	it('accepts only object variables', () => {
		expect(parseGraphqlVariables('{}')).toEqual({});
		expect(() => parseGraphqlVariables('[]')).toThrow('JSON object');
		expect(() => parseGraphqlVariables('invalid')).toThrow();
	});

	it('pages from returned values without dropping filters', () => {
		const next = graphqlPageVariables(variables, result, 1);
		expect(JSON.parse(next!)).toEqual({
			input: {
				dataset: 'history_ledgers',
				limit: 2,
				offset: 2,
				filters: [{ field: 'sequence', value: 3 }]
			}
		});
		expect(graphqlPageVariables(variables, result, -1)).toBeNull();
	});

	it('does not invent pages for short results, coverage queries, or GraphQL failures', () => {
		expect(
			graphqlPageVariables(
				variables,
				{ data: { hubbleQuery: { limit: 2, offset: 0, rows: [{}] } } },
				1
			)
		).toBeNull();
		expect(
			graphqlPageVariables('{}', { data: { hubbleStatus: {} } }, 1)
		).toBeNull();
		expect(
			graphqlPageVariables(
				variables,
				{ ...result, errors: [{ message: 'Unavailable' }] },
				1
			)
		).toBeNull();
	});
});
