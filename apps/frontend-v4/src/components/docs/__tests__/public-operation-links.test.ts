import {
	parsePublicOpenApiCatalog,
	publicOperationTryItUrl
} from '../../../api/public-openapi-catalog';

describe('documentation operation links', () => {
	it('opens the operation in the sole native API reference', () => {
		const catalog = parsePublicOpenApiCatalog({
			paths: {
				'/v1/analytics/ledgers/{sequence}': {
					get: {
						operationId: 'getAnalyticsLedger',
						tags: ['Analytics'],
						summary: 'Ledger detail'
					}
				}
			}
		});
		const group = catalog.groups[0]!;
		expect(publicOperationTryItUrl(group.operations[0]!, group.tag)).toBe(
			'/docs/api/getAnalyticsLedger'
		);
	});
	it('opens the native API directory without inventing an operation ID', () => {
		expect(
			publicOperationTryItUrl(
				{ method: 'GET', path: '/x', summary: 'X' },
				'Status and health'
			)
		).toBe('/docs/api');
	});
});
