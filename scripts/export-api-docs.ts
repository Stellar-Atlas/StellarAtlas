import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { collectDocsOperations } from '../apps/frontend-v4/src/components/docs/docs-operation-model.js';
import { projectOpenApiDocument } from '../apps/backend/src/core/infrastructure/http/OpenApiDocumentProjection.js';
import { createPublicOpenApiDocument } from '../apps/backend/src/core/infrastructure/http/PublicOpenApiDocument.js';
import { assertSelfContainedOpenApiDocument } from '../apps/backend/src/core/infrastructure/http/LocalPublicOpenApiSchemas.js';

// Same projector used by /docs/openapi.json. Build-only; never connects to a database.
const base = JSON.parse(
	await readFile(
		new URL('../apps/backend/openapi.json', import.meta.url),
		'utf8'
	)
);
const document = createPublicOpenApiDocument(base);
assertSelfContainedOpenApiDocument(document);
const paths = document.paths as Record<string, Record<string, unknown>>;
if (
	!paths?.['/v1/analytics/datasets/{dataset}/query'] ||
	!paths?.['/graphql']
) {
	throw new Error(
		'Public API specification is missing required analytics operations.'
	);
}
const output = new URL(
	'../apps/frontend-v4/generated/public-openapi.json',
	import.meta.url
);
await mkdir(new URL('.', output), { recursive: true });
await writeFile(output, JSON.stringify(document) + '\n');
console.log(
	'Exported public API specification from source: ' +
		Object.keys(paths).length +
		' paths → ' +
		fileURLToPath(output)
);

const operationDocuments = Object.fromEntries(
	collectDocsOperations(document).map((operation) => [
		operation.id,
		projectOpenApiDocument(document, {
			includeOperation: (candidate) =>
				candidate.path === operation.path &&
				candidate.method === operation.method,
			includeSecuritySchemes: true,
			info: document.info as Record<string, unknown>,
			servers: document.servers as Record<string, unknown>[],
			tags: document.tags as Record<string, unknown>[]
		})
	])
);
for (const operationDocument of Object.values(operationDocuments))
	assertSelfContainedOpenApiDocument(operationDocument);
await writeFile(
	new URL(
		'../apps/frontend-v4/generated/operation-openapi.json',
		import.meta.url
	),
	JSON.stringify(operationDocuments) + '\n'
);
console.log(
	'Exported ' +
		Object.keys(operationDocuments).length +
		' isolated operation schemas.'
);
