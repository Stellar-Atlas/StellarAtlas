import { rewriteSwaggerHtml } from '../swagger-proxy';

describe('rewriteSwaggerHtml', () => {
	it('routes Swagger assets locally and versions the generated API document', () => {
		const html = [
			'<link href="./swagger-ui.css" rel="stylesheet">',
			'<script src="./swagger-ui-bundle.js"></script>',
			'<script src="./swagger-ui-init.js"></script>'
		].join('');

		expect(rewriteSwaggerHtml(html, 'build 42')).toContain(
			'src="/api-docs/swagger-ui-init.js?v=build%2042"'
		);
		expect(rewriteSwaggerHtml(html, 'build 42')).toContain(
			'href="/api-docs/swagger-ui.css"'
		);
		expect(rewriteSwaggerHtml(html, 'build 42')).toContain(
			'src="/api-docs/swagger-ui-bundle.js"'
		);
	});
});
