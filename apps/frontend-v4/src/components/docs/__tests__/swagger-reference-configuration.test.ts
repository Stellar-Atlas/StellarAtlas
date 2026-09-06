import { swaggerReferenceUrl } from '../swagger-reference-configuration';

describe('complete embedded OpenAPI reference', () => {
	it('embeds the installed genuine Swagger UI without a CDN or arbitrary proxy', () => {
		expect(swaggerReferenceUrl('dark')).toBe('/api-docs?view=swagger&embedded=1&theme=dark');
	});
	it('keeps theme and operation deep links', () => {
		expect(swaggerReferenceUrl('light', '#/Analytics/getAnalyticsTransaction'))
			.toBe('/api-docs?view=swagger&embedded=1&theme=light#/Analytics/getAnalyticsTransaction');
		expect(swaggerReferenceUrl('dark', 'https://example.com')).not.toContain('example.com');
	});
});
