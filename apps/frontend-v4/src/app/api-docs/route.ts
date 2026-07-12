const apiBaseUrl =
	process.env.STELLAR_ATLAS_PUBLIC_API_URL?.trim() || 'http://127.0.0.1:3000';
const normalizedApiBaseUrl = apiBaseUrl.endsWith('/')
	? apiBaseUrl.slice(0, -1)
	: apiBaseUrl;

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
	const upstream = await fetch(`${normalizedApiBaseUrl}/docs/`, {
		cache: 'no-store'
	});
	const body = await upstream.text();
	const rewrittenBody = rewriteSwaggerHtml(body, Date.now().toString(36));

	return new Response(rewrittenBody, {
		headers: {
			'cache-control': 'no-store',
			'content-type': upstream.headers.get('content-type') ?? 'text/html'
		},
		status: upstream.status
	});
}
import { rewriteSwaggerHtml } from './swagger-proxy';
