import { rewriteSwaggerHtml } from '../swagger-proxy';

describe('rewriteSwaggerHtml', () => {
	it('routes Swagger assets locally and versions the generated API document', () => {
		const html = [
			'<body>',
			'<link href="./swagger-ui.css" rel="stylesheet">',
			'<script src="./swagger-ui-bundle.js"></script>',
			'<script src="./swagger-ui-init.js"></script>',
			'</body>'
		].join('');

		const rewritten = rewriteSwaggerHtml(html, 'build 42');

		expect(rewritten).toContain(
			'src="/api-docs/swagger-ui-init.js?v=build%2042"'
		);
		expect(rewritten).toContain('href="/api-docs/swagger-ui.css"');
		expect(rewritten).toContain('src="/api-docs/swagger-ui-bundle.js"');
	});

	it('adds the StellarAtlas desktop and mobile navigation once', () => {
		const rewritten = rewriteSwaggerHtml('<html><body></body></html>', 'v1');
		const rewrittenAgain = rewriteSwaggerHtml(rewritten, 'v2');

		expect(rewritten).toContain('data-stellaratlas-docs-shell');
		expect(rewritten).toContain('aria-label="Primary navigation"');
		expect(rewritten).toContain('aria-label="Mobile primary navigation"');
		expect(rewritten).toContain('href="/organizations"');
		expect(rewritten).toContain('Interactive API');
		expect(rewrittenAgain.match(/data-stellaratlas-docs-shell/g)).toHaveLength(
			1
		);
	});
});
