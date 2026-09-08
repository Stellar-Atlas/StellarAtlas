/** @jest-environment node */
import { jest } from '@jest/globals';
import { GET as embeddedReference } from '../../docs/reference/route';
import { GET as docsAlias } from '../route';

const redirected = new Error('Next redirect');
const redirect = jest.fn(() => {
	throw redirected;
});
jest.unstable_mockModule('next/navigation', () => ({ redirect }));
const { default: apiAlias } = await import('../../api/page');

describe('single documentation UI routing', () => {
	afterEach(() => jest.restoreAllMocks());

	it.each([
		['/api-docs?view=swagger', docsAlias],
		['/docs/reference?theme=dark', embeddedReference]
	] as const)(
		'redirects %s without rendering or fetching a second UI',
		(path, get) => {
			const fetcher = jest.spyOn(globalThis, 'fetch');
			const response = get(new Request('https://stellaratlas.io' + path));
			expect(response.status).toBe(307);
			expect(response.headers.get('location')).toBe(
				'https://stellaratlas.io/docs'
			);
			expect(fetcher).not.toHaveBeenCalled();
		}
	);

	it('redirects /api instead of rendering a DocsPage outside DocsLayout', () => {
		expect(() => apiAlias()).toThrow(redirected);
		expect(redirect).toHaveBeenCalledWith('/docs');
	});
});
