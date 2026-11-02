export function GET(_request: Request): Response {
	return new Response(null, { status: 307, headers: { Location: '/docs' } });
}
