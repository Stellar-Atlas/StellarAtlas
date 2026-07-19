import openApiDocument from '../../../../../openapi.json' with { type: 'json' };
import { createHistoricalOpenApiDocument } from '../HistoricalOpenApiDocument.js';
import { createOperatorOpenApiDocument } from '../OperatorOpenApiDocument.js';

describe('operator OpenAPI document', () => {
	const document = createOperatorOpenApiDocument(openApiDocument);
	const paths = readPaths(document);

	it('contains worker, community scanner, and internal comparison routes', () => {
		expect(paths['/v1/history-scan/job']).toBeDefined();
		expect(paths['/v1/history-scan/archive-object-job']).toBeDefined();
		expect(paths['/v1/community-scanners/register']).toBeDefined();
		expect(paths['/v1/cross-check/sources']).toBeDefined();
	});

	it('does not mix public or historical compatibility routes into operator docs', () => {
		expect(paths['/v1']).toBeUndefined();
		expect(paths['/v1/nodes']).toBeUndefined();
		expect(paths['/v1/history-scan/{url}']).toBeUndefined();
		expect(paths['/v1/archive-scans']).toBeUndefined();
	});

	it('retains only authentication schemes used by selected routes', () => {
		expect(document.components).toMatchObject({
			securitySchemes: {
				basicAuth: { scheme: 'basic', type: 'http' },
				bearerAuth: { scheme: 'bearer', type: 'http' }
			}
		});
	});
});

describe('historical OpenAPI document', () => {
	const document = createHistoricalOpenApiDocument(openApiDocument);
	const paths = readPaths(document);

	it('contains aliases and deprecated range routes but no worker routes', () => {
		expect(paths['/v1/node']).toBeDefined();
		expect(paths['/v1/organization']).toBeDefined();
		expect(paths['/v1/explorer/local-read-model']).toBeDefined();
		expect(paths['/v1/archive-scans']).toBeDefined();
		expect(paths['/v1/history-scan/{url}']).toBeDefined();
		expect(paths['/v1/history-scan/job']).toBeUndefined();
	});

	it('marks every route deprecated and gives every alias a unique operation id', () => {
		const operationIds = new Set<string>();
		for (const operation of operations(paths)) {
			expect(operation.deprecated).toBe(true);
			expect(operation.tags).toEqual(['Historical compatibility']);
			expect(operation.operationId).toEqual(expect.any(String));
			expect(operationIds.has(operation.operationId as string)).toBe(false);
			operationIds.add(operation.operationId as string);
		}
	});

	it('points known aliases to their canonical replacements', () => {
		expect(paths['/v1/node']?.get).toMatchObject({
			'x-canonical-path': '/v1/nodes'
		});
		expect(
			paths['/v1/archive-scans/{encodedUrl}/object-evidence']?.get
		).toMatchObject({
			'x-canonical-path': '/v2/archive-scans/{encodedUrl}/object-evidence'
		});
	});
});

function readPaths(
	document: Readonly<Record<string, unknown>>
): Record<string, Record<string, Record<string, unknown>>> {
	return document.paths as Record<
		string,
		Record<string, Record<string, unknown>>
	>;
}

function operations(
	paths: Readonly<
		Record<string, Readonly<Record<string, Record<string, unknown>>>>
	>
): Record<string, unknown>[] {
	const methods = new Set([
		'delete',
		'get',
		'head',
		'options',
		'patch',
		'post',
		'put',
		'trace'
	]);
	return Object.values(paths).flatMap((path) =>
		Object.entries(path)
			.filter(([method]) => methods.has(method))
			.map(([, operation]) => operation)
	);
}
