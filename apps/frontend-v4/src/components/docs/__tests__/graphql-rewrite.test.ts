import nextConfig from '../../../../next.config';

describe('same-origin GraphQL documentation transport', () => {
	it('uses the configured API base for one fixed GraphQL route', async () => {
		const config = await nextConfig.rewrites?.();
		if (!config || Array.isArray(config))
			throw new Error('Expected ordered rewrite routes');
		const routes = config.afterFiles ?? [];
		const apiBase =
			process.env.STELLAR_ATLAS_PUBLIC_API_URL?.trim() ||
			'http://127.0.0.1:3000';
		const normalizedBase = apiBase.endsWith('/')
			? apiBase.slice(0, -1)
			: apiBase;
		expect(routes.filter((route) => route.source.includes('graphql'))).toEqual([
			{ source: '/graphql', destination: normalizedBase + '/graphql' }
		]);
	});

	it('preserves the existing REST and raw OpenAPI routes', async () => {
		const config = await nextConfig.rewrites?.();
		if (!config || Array.isArray(config))
			throw new Error('Expected ordered rewrite routes');
		const routes = config.afterFiles ?? [];
		expect(routes.map((route) => route.source)).toEqual([
			'/graphql',
			'/horizon',
			'/horizon/:path*',
			'/rpc',
			'/api-docs/:path*',
			'/v1',
			'/v1/:path*'
		]);
		expect(config.beforeFiles).toEqual([{
			source: '/v1/analytics/accounts/:account/balances',
			has: [{ type: 'query', key: 'limit', value: '25' }],
			destination: '/api/explorer/account-balances/:account'
		}]);
		expect(config.fallback).toEqual([]);
	});
});
