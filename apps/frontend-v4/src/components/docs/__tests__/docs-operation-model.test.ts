import { collectDocsOperations, operationGroup } from '../docs-operation-model';

describe('generated documentation operation directory', () => {
	it('gives every actual method a distinct routable page without treating path metadata as operations', () => {
		const result = collectDocsOperations({
			paths: {
				'/v1/analytics/accounts/{account}/balances': {
					parameters: [],
					get: {
						operationId: 'balances',
						summary: 'Account balances',
						tags: ['Analytics']
					}
				},
				'/graphql': { post: { operationId: 'graphql', tags: ['Analytics'] } }
			}
		});
		expect(result).toHaveLength(2);
		expect(result.find((row) => row.id === 'balances')).toMatchObject({
			url: '/docs/api/balances',
			group: 'Accounts & balances',
			method: 'get'
		});
		expect(result.find((row) => row.id === 'graphql')?.group).toBe('GraphQL');
	});
	it('retains non-analytics public API families and operation descriptions', () => {
		expect(
			collectDocsOperations({
				paths: {
					'/rpc': {
						post: {
							operationId: 'rpc',
							tags: ['Data access'],
							description: 'Read-only JSON-RPC'
						}
					}
				}
			})[0]
		).toMatchObject({
			group: 'Data access',
			description: 'Read-only JSON-RPC'
		});
		expect(
			operationGroup('/v1/analytics/contracts/{contract}/events', 'Analytics')
		).toBe('Contracts & events');
	});
	it('fails a build on duplicate operation IDs rather than silently hiding endpoints', () => {
		expect(() =>
			collectDocsOperations({
				paths: {
					'/a': { get: { operationId: 'duplicate' } },
					'/b': { post: { operationId: 'duplicate' } }
				}
			})
		).toThrow('Duplicate');
	});
	it('creates stable route-safe IDs only when the source has no operation ID', () => {
		expect(
			collectDocsOperations({ paths: { '/v1/things/{id}': { get: {} } } })[0]
				?.id
		).toBe('get-v1-things-id');
	});
});
