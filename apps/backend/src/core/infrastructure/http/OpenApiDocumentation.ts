import type { Application, RequestHandler } from 'express';
import basicAuth from 'express-basic-auth';
import swaggerUi from 'swagger-ui-express';
import { createHistoricalOpenApiDocument } from './HistoricalOpenApiDocument.js';
import { createOperatorOpenApiDocument } from './OperatorOpenApiDocument.js';
import { createPublicOpenApiDocument } from './PublicOpenApiDocument.js';
import { swaggerDocsOptions } from './SwaggerDocsOptions.js';
import type { OpenApiRecord } from './OpenApiDocumentProjection.js';

export interface OpenApiDocumentationConfig {
	readonly document: unknown;
	readonly operatorPassword?: string;
	readonly operatorUserName?: string;
}

const docsHeaders: RequestHandler = (_req, res, next) => {
	res.set('Content-Security-Policy', "frame-src 'self'");
	next();
};

export function mountOpenApiDocumentation(
	api: Application,
	config: OpenApiDocumentationConfig
): void {
	const operatorAuth = createOperatorAuth(config);
	mountDocument(
		api,
		'/docs/operators',
		createOperatorOpenApiDocument(config.document),
		'StellarAtlas Operator API',
		[operatorAuth]
	);
	mountDocument(
		api,
		'/docs/historical',
		createHistoricalOpenApiDocument(config.document),
		'StellarAtlas Historical API'
	);
	mountDocument(
		api,
		'/docs',
		createPublicOpenApiDocument(config.document),
		'StellarAtlas Public API'
	);
}

function mountDocument(
	api: Application,
	path: string,
	document: OpenApiRecord,
	title: string,
	guards: readonly RequestHandler[] = []
): void {
	api.get(`${path}/openapi.json`, ...guards, (_req, res) => res.json(document));
	api.use(
		path,
		...guards,
		docsHeaders,
		swaggerUi.serve,
		swaggerUi.setup(document, {
			...swaggerDocsOptions,
			customSiteTitle: title
		})
	);
}

function createOperatorAuth(
	config: OpenApiDocumentationConfig
): RequestHandler {
	if (config.operatorUserName && config.operatorPassword) {
		return basicAuth({
			challenge: true,
			users: { [config.operatorUserName]: config.operatorPassword }
		});
	}
	return (_req, res) => res.status(404).send('Not Found');
}
