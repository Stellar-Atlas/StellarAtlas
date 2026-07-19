import {
	projectOpenApiDocument,
	type OpenApiOperationContext,
	type OpenApiRecord
} from './OpenApiDocumentProjection.js';
import { isHistoricalOpenApiOperation } from './OpenApiOperationClassification.js';

const historicalTag = {
	description:
		'Deprecated aliases and compatibility routes retained for existing clients.',
	name: 'Historical compatibility'
};

export function createHistoricalOpenApiDocument(
	document: unknown
): OpenApiRecord {
	return projectOpenApiDocument(document, {
		includeOperation: isHistoricalOpenApiOperation,
		info: {
			description:
				'Deprecated compatibility routes. New integrations should use the canonical public API document.',
			title: 'StellarAtlas Historical Compatibility API'
		},
		servers: [
			{
				description: 'StellarAtlas production API',
				url: 'https://api.stellaratlas.io'
			}
		],
		tags: [historicalTag],
		transformOperation: markHistoricalOperation
	});
}

function markHistoricalOperation({
	method,
	operation,
	path
}: OpenApiOperationContext): OpenApiRecord {
	const canonicalPath = canonicalReplacement(path);
	const description = [
		typeof operation.description === 'string' ? operation.description : null,
		canonicalPath === null
			? 'This compatibility route is deprecated.'
			: `This compatibility route is deprecated. Use ${canonicalPath}.`
	]
		.filter((value): value is string => value !== null)
		.join('\n\n');

	return {
		...operation,
		deprecated: true,
		description,
		operationId: historicalOperationId(method, path),
		tags: [historicalTag.name],
		...(canonicalPath === null ? {} : { 'x-canonical-path': canonicalPath })
	};
}

function historicalOperationId(method: string, path: string): string {
	const pathName = path
		.replaceAll(/[{}]/g, '')
		.split(/[^A-Za-z0-9]+/)
		.filter(Boolean)
		.map((part) => part[0]!.toUpperCase() + part.slice(1))
		.join('');
	return `historical${method[0]!.toUpperCase()}${method.slice(1)}${pathName}`;
}

function canonicalReplacement(path: string): string | null {
	if (path.startsWith('/v1/node')) return path.replace('/v1/node', '/v1/nodes');
	if (path.startsWith('/v1/organization')) {
		return path.replace('/v1/organization', '/v1/organizations');
	}
	if (path === '/v1/archive-scans/{encodedUrl}/object-evidence') {
		return '/v2/archive-scans/{encodedUrl}/object-evidence';
	}
	if (path === '/v1/history-scan/{url}') {
		return '/v2/archive-scans/{encodedUrl}/object-evidence';
	}
	if (path === '/v1/archive-scans') {
		return '/v1/archive-scans/objects/status-summary';
	}
	if (path === '/v1/archive-scans/queue') {
		return '/v1/archive-scans/objects';
	}
	return null;
}
