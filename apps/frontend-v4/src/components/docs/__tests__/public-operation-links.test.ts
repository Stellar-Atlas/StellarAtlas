import {
	parsePublicOpenApiCatalog,
	publicOperationTryItUrl
} from '../../../api/public-openapi-catalog';

describe('documentation operation links', () => {
	it('opens the live operation ID under its Swagger tag', () => {
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
			'/api-docs?view=swagger#/Analytics/getAnalyticsLedger'
		);
	});
	it('opens the tag without inventing an operation ID', () => {
		expect(
			publicOperationTryItUrl(
				{ method: 'GET', path: '/x', summary: 'X' },
				'Status and health'
			)
		).toBe('/api-docs?view=swagger#/Status%20and%20health');
	});
});
