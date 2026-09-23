export function GET(request: Request): Response {
	// Preserve the established entry URL; raw OpenAPI and asset subpaths keep their existing routes.
	return Response.redirect(new URL('/docs', request.url), 307);
}
