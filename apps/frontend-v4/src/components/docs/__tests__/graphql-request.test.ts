import {
	graphqlExamples,
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

describe('typed transfer GraphQL pagination', () => {
	it('uses the server cursor without changing exact filters', () => {
		const variables = JSON.stringify({
			account: 'GACCOUNT',
			input: { asset: 'native', minAmountRaw: '9007199254740993', limit: 10 }
		});
		const result = {
			data: {
				hubbleAccountTransfers: {
					nextCursor: 'opaque-cursor',
					transfers: [{ amountRaw: '9007199254740993' }]
				}
			}
		};
		expect(JSON.parse(graphqlPageVariables(variables, result, 1)!)).toEqual({
			account: 'GACCOUNT',
			input: {
				asset: 'native',
				minAmountRaw: '9007199254740993',
				limit: 10,
				after: 'opaque-cursor'
			}
		});
		expect(graphqlPageVariables(variables, result, -1)).toBeNull();
	});
	it('does not invent a cursor after the final or failed page', () => {
		expect(
			graphqlPageVariables(
				'{"input":{}}',
				{ data: { hubbleTransfers: { nextCursor: null, transfers: [] } } },
				1
			)
		).toBeNull();
		expect(
			graphqlPageVariables(
				'{"input":{}}',
				{
					data: { hubbleTransfers: { nextCursor: 'x' } },
					errors: [{ message: 'bad' }]
				},
				1
			)
		).toBeNull();
	});
});

describe('typed holder GraphQL pagination', () => {
	it('keeps the asset and limit while carrying the returned account cursor', () => {
		const variables = JSON.stringify({
			asset: 'USD:GISSUER',
			input: { limit: 10 }
		});
		const result = {
			data: {
				hubbleAssetHolders: {
					nextCursor: 'GACCOUNT',
					holders: [{ balance: 1.25, amountPrecision: 'float64-observation' }]
				}
			}
		};
		expect(JSON.parse(graphqlPageVariables(variables, result, 1)!)).toEqual({
			asset: 'USD:GISSUER',
			input: { limit: 10, after: 'GACCOUNT' }
		});
		expect(graphqlPageVariables(variables, result, -1)).toBeNull();
		expect(
			graphqlPageVariables(
				variables,
				{ data: { hubbleAssetHolders: { nextCursor: null, holders: [] } } },
				1
			)
		).toBeNull();
	});
	it('provides an executable typed-holder example with coverage and source precision', () => {
		expect(graphqlExamples.holders.query).toContain('hubbleAssetHolders');
		expect(graphqlExamples.holders.query).toContain('amountPrecision');
		expect(graphqlExamples.holders.query).toContain('snapshotPinned');
		expect(graphqlExamples.holders.variables).toEqual({
			asset: 'native',
			input: { limit: 10 }
		});
	});
});
