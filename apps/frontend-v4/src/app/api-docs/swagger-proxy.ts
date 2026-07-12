export function rewriteSwaggerHtml(body: string, version: string): string {
	const rewritten = body
		.replaceAll('href="./', 'href="/api-docs/')
		.replaceAll('src="./', 'src="/api-docs/');

	return rewritten.replace(
		'src="/api-docs/swagger-ui-init.js"',
		`src="/api-docs/swagger-ui-init.js?v=${encodeURIComponent(version)}"`
	);
}
