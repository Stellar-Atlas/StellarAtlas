import { graphqlExamples } from '../graphql-request';
import { transactionPageVariables } from '../graphql-transaction-request';
describe('transaction documentation pagination', () => {
	it.each(['transaction', 'soroban'] as const)(
		'keeps all three relationship controls pageable for %s',
		(key) => {
			const example = graphqlExamples[key];
			expect(example.kind).toBe('transaction');
			expect(example.query).toBe(graphqlExamples.transaction.query);
			const previous = {
				...example.variables,
				operationsAfter: 'op-old',
				effectsAfter: 'effect-old',
				eventsAfter: 'event-old'
			};
			const result = {
				data: {
					hubbleTransaction: {
						operations: { nextCursor: 'op-next' },
						effects: { nextCursor: 'effect-next' },
						events: { nextCursor: 'event-next' }
					}
				}
			};
			for (const relation of ['operations', 'effects', 'events'] as const) {
				const paged = transactionPageVariables(
					JSON.stringify(previous),
					result,
					relation
				);
				expect(JSON.parse(paged!)).toEqual({
					...previous,
					[relation + 'After']:
						result.data.hubbleTransaction[relation].nextCursor
				});
			}
		}
	);
	it('keeps the classic pagination fixture and loads the published Soroban invocation separately', () => {
		expect(graphqlExamples.transaction.variables).toMatchObject({
			ledgerSequence: 26000000,
			limit: 5
		});
		expect(graphqlExamples.soroban.label).toBe(
			'Soroban invocation and contract events'
		);
		expect(graphqlExamples.soroban.variables).toEqual({
			transactionHash:
				'446670351d9f2af449eda3bfa0e36c3e128e2720443293dd5b585b3bbadeb485',
			ledgerSequence: 63490364,
			limit: 10
		});
	});
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
