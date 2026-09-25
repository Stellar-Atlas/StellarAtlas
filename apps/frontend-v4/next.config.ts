import type { NextConfig } from 'next';

const apiBaseUrl =
	process.env.STELLAR_ATLAS_PUBLIC_API_URL?.trim() || 'http://127.0.0.1:3000';
const normalizedApiBaseUrl = apiBaseUrl.endsWith('/')
	? apiBaseUrl.slice(0, -1)
	: apiBaseUrl;
// Keep Horizon's generated resource links on the public API origin, not loopback.
const publicDataApiBaseUrl = 'https://api.stellaratlas.io';

const nextConfig: NextConfig = {
	distDir: process.env.NEXT_DIST_DIR ?? '.next-production',
	experimental: {
		serverActions: {
			allowedOrigins: [
				'stellaratlas.io',
				'www.stellaratlas.io',
				'127.0.0.1:3104',
				'127.0.0.1:3114',
				'localhost:3104',
				'localhost:3114'
			]
		}
	},
	productionBrowserSourceMaps: true,
	reactStrictMode: true,
	rewrites: async () => [
		{
			destination: `${normalizedApiBaseUrl}/graphql`,
			source: '/graphql'
		},
		{
			destination: `${publicDataApiBaseUrl}/horizon/`,
			source: '/horizon'
		},
		{
			destination: `${publicDataApiBaseUrl}/horizon/:path*`,
			source: '/horizon/:path*'
		},
		{
			destination: `${publicDataApiBaseUrl}/rpc`,
			source: '/rpc'
		},
		{
			destination: `${normalizedApiBaseUrl}/docs/:path*`,
			source: '/api-docs/:path*'
		},
		{
			destination: `${normalizedApiBaseUrl}/v1`,
			source: '/v1'
		},
		{
			destination: `${normalizedApiBaseUrl}/v1/:path*`,
			source: '/v1/:path*'
		}
	]
};

export default nextConfig;
