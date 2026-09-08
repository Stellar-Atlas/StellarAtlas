import type { Application } from 'express';
import { createPublicOpenApiDocument } from './PublicOpenApiDocument.js';

export interface OpenApiDocumentationConfig {
	readonly document: unknown;
}

/** One documentation UI; the backend serves only its consumer machine contract. */
export function mountOpenApiDocumentation(
	api: Application,
	config: OpenApiDocumentationConfig
): void {
	const publicDocument = createPublicOpenApiDocument(config.document);
	api.get('/docs/openapi.json', (_req, res) => res.json(publicDocument));
	api.get(['/docs', '/docs/operators', '/docs/historical'], (_req, res) => {
		res.redirect(307, 'https://stellaratlas.io/docs');
	});
	// Do not redirect machine-spec or retired Swagger asset requests to HTML.
	api.use('/docs', (_req, res) => res.status(404).send('Not Found'));
}
