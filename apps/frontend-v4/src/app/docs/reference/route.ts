export function GET(request: Request): Response {
	return Response.redirect(new URL('/docs', request.url), 307);
}
