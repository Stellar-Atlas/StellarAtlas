import nextConfig from '../../../../next.config';

describe('same-origin GraphQL documentation transport', () => {
	it('uses the configured API base for one fixed GraphQL route', async () => {
		const routes = await nextConfig.rewrites?.();
		expect(Array.isArray(routes)).toBe(true);
		if (!Array.isArray(routes)) throw new Error('Expected fixed rewrite routes');
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
		const routes = await nextConfig.rewrites?.();
		if (!Array.isArray(routes)) throw new Error('Expected fixed rewrite routes');
		expect(routes.map((route) => route.source)).toEqual([
			'/graphql',
			'/api-docs/:path*',
			'/v1',
			'/v1/:path*'
		]);
	});
});
