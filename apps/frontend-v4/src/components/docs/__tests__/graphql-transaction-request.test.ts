import { transactionPageVariables } from '../graphql-transaction-request';
describe('transaction documentation pagination', () => {
	const variables = JSON.stringify({
		transactionHash: 'a'.repeat(64),
		ledgerSequence: 26000000,
		limit: 5,
		operationsAfter: 'op-old'
	});
	it('changes only the requested relation cursor and preserves transaction identity', () => {
		const result = {
			data: {
				hubbleTransaction: {
					operations: { nextCursor: 'op-next' },
					effects: { nextCursor: 'effect-next' },
					events: { nextCursor: null }
				}
			}
		};
		expect(
			JSON.parse(transactionPageVariables(variables, result, 'effects')!)
		).toEqual({
			transactionHash: 'a'.repeat(64),
			ledgerSequence: 26000000,
			limit: 5,
			operationsAfter: 'op-old',
			effectsAfter: 'effect-next'
		});
		expect(transactionPageVariables(variables, result, 'events')).toBeNull();
	});
	it('never invents cursors for missing or failed data', () => {
		expect(
			transactionPageVariables(
				variables,
				{ data: { hubbleTransaction: null } },
				'effects'
			)
		).toBeNull();
		expect(
			transactionPageVariables(
				variables,
				{
					data: { hubbleTransaction: { effects: { nextCursor: 'x' } } },
					errors: [{}]
				},
				'effects'
			)
		).toBeNull();
	});
});
