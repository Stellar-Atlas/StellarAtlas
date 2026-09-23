import { createOpenAPI } from 'fumadocs-openapi/server';
import type { OpenAPIPageProps_Spec } from 'fumadocs-openapi/ui';
import operationDocuments from '../../../generated/operation-openapi.json';
import type { DocsOperation } from './docs-operation-model';

type Document = OpenAPIPageProps_Spec['payload']['bundled'];
const server = createOpenAPI({
	input: operationDocuments as unknown as Record<string, Document>
});

export async function getDocsOperationProps(
	operation: DocsOperation
): Promise<OpenAPIPageProps_Spec> {
	const { bundled } = await server.getSchema(operation.id);
	return {
		payload: { bundled },
		operations: [{ path: operation.path, method: operation.method }],
		showTitle: false
	};
}
