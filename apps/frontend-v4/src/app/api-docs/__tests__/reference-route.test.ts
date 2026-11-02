/** @jest-environment node */
import { jest } from '@jest/globals';
import 'next/dist/server/node-environment';
import { AppRouteRouteModule } from 'next/dist/server/route-modules/app-route/module';
import type { RouteKind } from 'next/dist/server/route-kind';
import { NextRequest } from 'next/server';
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
			expect(response.headers.get('location')).toBe('/docs');
			expect(fetcher).not.toHaveBeenCalled();
		}
	);
	it.each([
		'http://localhost:3114',
		'https://localhost:3114',
		'http://127.0.0.1:3114',
		'https://stellaratlas.io',
		'https://www.stellaratlas.io'
	])('keeps both aliases relative for %s, dropping query context', (origin) => {
		for (const [path, get] of [
			['/api-docs', docsAlias],
			['/docs/reference', embeddedReference]
		] as const) {
			const response = get(
				new Request(
					origin +
						path +
						'?view=swagger&return_to=https%3A%2F%2Fexample.invalid'
				)
			);
			expect(response.status).toBe(307);
			expect(response.headers.get('location')).toBe('/docs');
		}
	});

	it('redirects /api instead of rendering a DocsPage outside DocsLayout', () => {
		expect(() => apiAlias()).toThrow(redirected);
		expect(redirect).toHaveBeenCalledWith('/docs');
	});
	it('preserves relative Location through actual Next route dispatch', async () => {
		for (const [pathname, get] of [
			['/api-docs', docsAlias],
			['/docs/reference', embeddedReference]
		] as const) {
			const route = new AppRouteRouteModule({
				definition: {
					kind: 'APP_ROUTE' as RouteKind.APP_ROUTE,
					page: pathname + '/route',
					pathname,
					filename: 'route',
					bundlePath: pathname + '/route'
				},
				resolvedPagePath: pathname + '/route.ts',
				distDir: '.next-test',
				relativeProjectDir: '.',
				nextConfigOutput: undefined,
				userland: () => ({ GET: get, generateStaticParams: undefined })
			});
			for (const origin of [
				'https://localhost:3114',
				'https://stellaratlas.io',
				'https://www.stellaratlas.io'
			]) {
				const response = await route.handle(
					new NextRequest(origin + pathname + '?view=swagger'),
					{
						params: undefined,
						previewProps: {
							previewModeId: '',
							previewModeSigningKey: '',
							previewModeEncryptionKey: ''
						},
						renderOpts: {
							cacheLifeProfiles: {
								default: { stale: 300, revalidate: 900, expire: 4294967294 }
							},
							staticPageGenerationTimeout: 60,
							cacheComponents: false,
							validationLevel: 'warning',
							experimental: {
								authInterrupts: false,
								useCacheTimeout: 30000,
								durableUseCacheEntries: false
							},
							assetPrefix: '',
							isBuildTimePrerendering: false,
							isDraftMode: false,
							isDebugDynamicAccesses: false
						},
						sharedContext: {
							buildId: 'redirect-test',
							deploymentId: 'redirect-test'
						}
					}
				);
				expect(response.status).toBe(307);
				expect(response.headers.get('location')).toBe('/docs');
			}
		}
	});
});
