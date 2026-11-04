/** The recent transaction feed lives at /explorer; only the bare list is an alias. */
export function GET(request: Request): Response {
	return new Response(null, {
		status: 307,
		headers: {
			location: '/explorer' + new URL(request.url).search,
			'cache-control': 'no-store'
		}
	});
}

export const HEAD = GET;
