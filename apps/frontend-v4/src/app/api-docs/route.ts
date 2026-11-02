export function GET(_request: Request): Response {
	// Preserve the established entry URL; raw OpenAPI and asset subpaths keep their existing routes.
	return new Response(null, { status: 307, headers: { Location: '/docs' } });
}
