/** @jest-environment node */
import { jest } from '@jest/globals';
import 'next/dist/server/node-environment';
import { AppRouteRouteModule } from 'next/dist/server/route-modules/app-route/module';
import type { RouteKind } from 'next/dist/server/route-kind';
import { NextRequest } from 'next/server';
import { GET, HEAD, OPTIONS } from '../route';

describe('modern frontend identity contract', () => {
	it('returns a release-independent no-store identity without fetching', async () => {
		const fetcher = jest.spyOn(globalThis, 'fetch');
		try {
			const response = GET();
			expect(response.status).toBe(200);
			expect(response.headers.get('content-type')).toBe('application/json');
			expect(response.headers.get('cache-control')).toBe('no-store');
			const body = await response.text();
			expect(new TextEncoder().encode(body).length).toBeLessThanOrEqual(256);
			expect(JSON.parse(body)).toEqual({ application: 'stellaratlas-modern-frontend', contractVersion: 1 });
			expect(fetcher).not.toHaveBeenCalled();
		} finally { fetcher.mockRestore(); }
	});
	it('returns the same HEAD headers without a body', async () => {
		const response = HEAD();
		expect(response.status).toBe(200);
		expect([...response.headers]).toEqual([...GET().headers]);
		expect(await response.text()).toBe('');
	});
	it('dispatches GET/HEAD and rejects writes through actual Next routing', async () => {
		const route = new AppRouteRouteModule({
			definition: { kind: 'APP_ROUTE' as RouteKind.APP_ROUTE, page: '/frontend-identity/route', pathname: '/frontend-identity', filename: 'route', bundlePath: 'app/frontend-identity/route' },
			distDir: '.next-test', relativeProjectDir: '.', resolvedPagePath: '/frontend-identity/route.ts', nextConfigOutput: undefined,
			userland: () => ({ GET, HEAD, OPTIONS, generateStaticParams: undefined })
		});
		for (const method of ['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE']) {
			const response = await route.handle(new NextRequest('https://stellaratlas.io/frontend-identity', {method}), {
				params: undefined, previewProps: { previewModeId: '', previewModeSigningKey: '', previewModeEncryptionKey: '' },
				sharedContext: { buildId: 'identity-test', deploymentId: 'any-legitimate-release' },
				renderOpts: {
					cacheLifeProfiles: { default: { stale: 300, revalidate: 900, expire: 4294967294 } }, staticPageGenerationTimeout: 60,
					cacheComponents: false, validationLevel: 'warning', assetPrefix: '', isBuildTimePrerendering: false, isDraftMode: false, isDebugDynamicAccesses: false,
					experimental: { authInterrupts: false, useCacheTimeout: 30000, durableUseCacheEntries: false },
					waitUntil: undefined, onClose: () => undefined, onAfterTaskError: undefined
				}
			});
			expect(response.status).toBe(method === 'GET' || method === 'HEAD' ? 200 : 405);
			if (method === 'GET') expect(await response.json()).toEqual({ application: 'stellaratlas-modern-frontend', contractVersion: 1 });
			if (method === 'HEAD') expect(await response.text()).toBe('');
		}
	});
});
