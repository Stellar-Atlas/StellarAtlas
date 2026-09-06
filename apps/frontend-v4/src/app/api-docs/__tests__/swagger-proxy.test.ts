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
		expect(rewritten).not.toContain('data-stellaratlas-docs-embed');
		expect(rewrittenAgain.match(/data-stellaratlas-docs-shell/g)).toHaveLength(
			1
		);
	});
});

describe('embedded Swagger reference', () => {
	it('keeps all Swagger assets and omits duplicate site navigation inside /docs', () => {
		const html = rewriteSwaggerHtml(
			'<body><div id="swagger-ui"></div><script src="./swagger-ui-init.js"></script></body>',
			'release',
			{ embedded: true }
		);
		expect(html).toContain('id="swagger-ui"');
		expect(html).toContain('/api-docs/swagger-ui-init.js?v=release');
		expect(html).not.toContain('sa-docs-header');
		expect(html).toContain('data-stellaratlas-docs-embed');
		expect(html).toContain('min-height: 0 !important');
	});
	it('adapts only styles to the light site theme, not response data', () => {
		const html = rewriteSwaggerHtml(
			'<body><style>body { background: #101417; color: #e8f0ef; }</style><code>#101417</code></body>',
			'release',
			{ embedded: true, theme: 'light' }
		);
		expect(html).toContain('background: #f4f7fa');
		expect(html).toContain('color: #172231');
		expect(html).toContain('<code>#101417</code>');
	});
});
