import { graphqlPageVariables } from '../graphql-request';

describe('GraphiQL typed analytics page loading', () => {
	it('carries account balance cursor without dropping the account', () => {
		expect(
			JSON.parse(
				graphqlPageVariables(
					JSON.stringify({ account: 'GACCOUNT', input: { limit: 10 } }),
					{ data: { hubbleAccountBalances: { nextCursor: 'opaque-balance' } } },
					1
				)!
			)
		).toEqual({
			account: 'GACCOUNT',
			input: { limit: 10, after: 'opaque-balance' }
		});
	});
	it.each([
		'hubbleOperations',
		'hubbleAssets',
		'hubbleContracts',
		'hubbleTrades',
		'hubbleOffers',
		'hubbleQuery'
	])('uses only the explicit nextOffset for %s', (field) => {
		const variables = JSON.stringify({
			input: {
				minLedger: 63490364,
				maxLedger: 63490365,
				type: 'payment',
				limit: 10,
				offset: 0
			}
		});
		const page = { rows: [], limit: 10, offset: 0, nextOffset: 10 };
		expect(
			JSON.parse(
				graphqlPageVariables(variables, { data: { [field]: page } }, 1)!
			)
		).toEqual({
			input: {
				minLedger: 63490364,
				maxLedger: 63490365,
				type: 'payment',
				limit: 10,
				offset: 10
			}
		});
		for (const nextOffset of [null, -1, 1.5, '10']) {
			expect(
				graphqlPageVariables(
					variables,
					{ data: { [field]: { ...page, nextOffset } } },
					1
				)
			).toBeNull();
		}
	});
	it('does not invent another aggregate page when a full result ends at nextOffset:null', () => {
		expect(
			graphqlPageVariables(
				'{"input":{"dataset":"history_operations","limit":1,"offset":0}}',
				{
					data: {
						hubbleQuery: {
							rows: [{ records: '2' }],
							limit: 1,
							offset: 0,
							nextOffset: null
						}
					}
				},
				1
			)
		).toBeNull();
	});
});
