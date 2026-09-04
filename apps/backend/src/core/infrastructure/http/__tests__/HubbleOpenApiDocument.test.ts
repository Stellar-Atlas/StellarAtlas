import { withHubbleOpenApiPaths } from '../HubbleOpenApiDocument.js';

describe('Hubble OpenAPI paths', () => {
	const document = withHubbleOpenApiPaths({
		info: { title: 'test', version: '1' },
		openapi: '3.0.3',
		paths: {}
	});
	const paths = document.paths as Record<
		string,
		Record<string, Record<string, unknown>>
	>;

	it('documents the semantic history and Soroban query surface', () => {
		expect(
			paths['/v1/analytics/transactions/{transactionHash}']?.get?.operationId
		).toBe('getAnalyticsTransaction');
		expect(paths['/v1/analytics/ledgers/{sequence}']?.get?.operationId).toBe(
			'getAnalyticsLedger'
		);
		expect(
			paths['/v1/analytics/ledgers/{sequence}/transactions']?.get?.operationId
		).toBe('listAnalyticsLedgerTransactions');
		expect(
			paths['/v1/analytics/operations/{operationId}']?.get?.operationId
		).toBe('getAnalyticsOperation');
		expect(
			paths['/v1/analytics/operations/{operationId}/effects']?.get?.operationId
		).toBe('listAnalyticsOperationEffects');
		expect(
			paths['/v1/analytics/accounts/{account}/effects']?.get?.operationId
		).toBe('listAnalyticsAccountEffects');
		expect(paths['/v1/analytics/trades']?.get?.operationId).toBe(
			'searchAnalyticsTrades'
		);
		expect(
			paths['/v1/analytics/assets/{asset}/transfers']?.get?.operationId
		).toBe('listAnalyticsAssetTransfers');
		expect(
			paths['/v1/analytics/contracts/{contractId}/state']?.get?.operationId
		).toBe('listAnalyticsContractState');
	});

	it('keeps every analytics operation public', () => {
		for (const [path, pathItem] of Object.entries(paths)) {
			if (!path.startsWith('/v1/analytics')) continue;
			for (const operation of Object.values(pathItem)) {
				expect(operation.security).toEqual([]);
			}
		}
	});
});
