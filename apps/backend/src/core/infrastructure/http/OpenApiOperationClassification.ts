import {
	readOpenApiStringArray,
	type OpenApiOperationContext
} from './OpenApiDocumentProjection.js';

const operatorTags = new Set([
	'Archive scanner operators',
	'Community scanner operators',
	'CrossCheck'
]);

const historicalPathPatterns = [
	/^\/v1\/archive-scans\/\{encodedUrl\}\/object-evidence$/,
	/^\/v1\/explorer\/local-/,
	/^\/v1\/node(?:\/|$)/,
	/^\/v1\/organization(?:\/|$)/
];

export function isHistoricalOpenApiOperation({
	operation,
	path
}: OpenApiOperationContext): boolean {
	return (
		operation.deprecated === true ||
		path === '/v1/history-scan/{url}' ||
		historicalPathPatterns.some((pattern) => pattern.test(path))
	);
}

export function isOperatorOpenApiOperation(
	context: OpenApiOperationContext
): boolean {
	if (isHistoricalOpenApiOperation(context)) return false;
	const { operation, path } = context;
	if (path.startsWith('/v1/cross-check')) return true;
	if (operation['x-internal'] === true) return true;
	if (
		readOpenApiStringArray(operation.tags).some((tag) => operatorTags.has(tag))
	) {
		return true;
	}
	return Array.isArray(operation.security) && operation.security.length > 0;
}

export function isPublicOpenApiOperation(
	context: OpenApiOperationContext
): boolean {
	if (
		isHistoricalOpenApiOperation(context) ||
		isOperatorOpenApiOperation(context)
	) {
		return false;
	}
	const security = context.operation.security;
	return (
		security === undefined || (Array.isArray(security) && security.length === 0)
	);
}
