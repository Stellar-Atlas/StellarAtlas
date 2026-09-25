import {
	getRedirectUrl,
	getRewrittenUrl,
	unstable_getResponseFromNextConfig
} from 'next/experimental/testing/server';
import nextConfig from '../../../../next.config';

const apiBase = 'https://api.stellaratlas.io';

async function rewrite(path: string): Promise<string | null> {
	let url = 'https://stellaratlas.io' + path;
	for (let redirects = 0; redirects < 2; redirects += 1) {
		const response = await unstable_getResponseFromNextConfig({
			url,
			nextConfig
		});
		const redirected = getRedirectUrl(response);
		if (redirected) {
			// These redirects preserve the HTTP method and request body.
			expect([307, 308]).toContain(response.status);
			url = redirected;
		} else return getRewrittenUrl(response);
	}
	throw new Error('Unexpected rewrite redirect loop');
}

describe('same-origin Horizon and RPC transport', () => {
	it.each(['/horizon', '/horizon/'])(
		'forwards %s to the Horizon root',
		async (path) => {
			expect(await rewrite(path)).toBe(apiBase + '/horizon/');
		}
	);

	it('preserves Horizon resource paths and paging queries', async () => {
		expect(
			await rewrite(
				'/horizon/accounts/GTEST/payments?cursor=42&order=desc&limit=2'
			)
		).toBe(
			apiBase + '/horizon/accounts/GTEST/payments?cursor=42&order=desc&limit=2'
		);
	});

	it.each(['/rpc', '/rpc/'])(
		'forwards %s without a method restriction',
		async (path) => {
			expect(await rewrite(path + '?request_id=7')).toBe(
				apiBase + '/rpc?request_id=7'
			);
			const routes = await nextConfig.rewrites?.();
			if (!Array.isArray(routes))
				throw new Error('Expected fixed rewrite routes');
			expect(routes.find((route) => route.source === '/rpc')).toEqual({
				source: '/rpc',
				destination: apiBase + '/rpc'
			});
		}
	);

	it('does not allow a query parameter to select another upstream', async () => {
		const destination = await rewrite(
			'/rpc?url=https%3A%2F%2Fexample.invalid%2F'
		);
		expect(destination).not.toBeNull();
		if (!destination) throw new Error('Missing RPC rewrite');
		expect(new URL(destination).origin).toBe(new URL(apiBase).origin);
	});
});
