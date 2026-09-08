/** @jest-environment node */
import { GET as embeddedReference } from '../../docs/reference/route';
import { GET as docsAlias } from '../route';

describe('documentation routing', () => {
	afterEach(() => jest.restoreAllMocks());
	it('routes the old docs entry to native documentation without fetching the backend', () => {
		const fetcher = jest.spyOn(globalThis, 'fetch');
		const response = docsAlias(
			new Request('https://stellaratlas.io/api-docs?view=swagger')
		);
		expect(response.status).toBe(307);
		expect(response.headers.get('location')).toBe(
			'https://stellaratlas.io/docs'
		);
		expect(fetcher).not.toHaveBeenCalled();
	});
	it('retains the old explicit embedded reference endpoint for existing integrations', async () => {
		const fetcher = jest
			.spyOn(globalThis, 'fetch')
			.mockResolvedValue(
				new Response('<html><body><div id="swagger-ui"></div></body></html>', {
					headers: { 'content-type': 'text/html' }
				})
			);
		const response = await embeddedReference(
			new Request('https://stellaratlas.io/docs/reference')
		);
		expect(await response.text()).not.toContain('sa-docs-header');
		expect(fetcher).toHaveBeenCalledWith(expect.stringMatching(/\/docs\/$/), {
			cache: 'no-store'
		});
	});
});
