import { rewriteSwaggerHtml } from './swagger-proxy';

const apiBaseUrl =
	process.env.STELLAR_ATLAS_PUBLIC_API_URL?.trim() || 'http://127.0.0.1:3000';
const normalizedApiBaseUrl = apiBaseUrl.replace(/\/$/, '');

export async function renderSwaggerReference(
	request: Request,
	embedded: boolean
): Promise<Response> {
	const upstream = await fetch(`${normalizedApiBaseUrl}/docs/`, {
		cache: 'no-store'
	});
	const url = new URL(request.url);
	const body = rewriteSwaggerHtml(
		await upstream.text(),
		Date.now().toString(36),
		{
			embedded,
			theme: url.searchParams.get('theme') === 'light' ? 'light' : 'dark'
		}
	);
	return new Response(body, {
		headers: {
			'cache-control': 'no-store',
			'content-type': upstream.headers.get('content-type') ?? 'text/html'
		},
		status: upstream.status
	});
}
