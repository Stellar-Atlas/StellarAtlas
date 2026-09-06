/** @jest-environment node */
import { GET as embeddedReference } from '../../docs/reference/route';
import { GET as standaloneReference } from '../route';

describe('path-bound Swagger reference', () => {
	afterEach(() => jest.restoreAllMocks());
	it('omits inner chrome without relying on a query while preserving standalone navigation', async () => {
		const fetcher = jest
			.spyOn(globalThis, 'fetch')
			.mockImplementation(
				async () =>
					new Response(
						'<html><body><div id="swagger-ui"></div></body></html>',
						{ headers: { 'content-type': 'text/html' } }
					)
			);
		const embedded = await embeddedReference(
			new Request('https://stellaratlas.io/docs/reference')
		);
		expect(await embedded.text()).not.toContain('sa-docs-header');
		const standalone = await standaloneReference(
			new Request('https://stellaratlas.io/api-docs')
		);
		expect(await standalone.text()).toContain('sa-docs-header');
		expect(fetcher).toHaveBeenCalledWith(expect.stringMatching(/\/docs\/$/), {
			cache: 'no-store'
		});
		expect(embedded.headers.get('cache-control')).toBe('no-store');
	});
});
