import { fetchJson, type FetchOptions } from './client';

const HTTP_METHODS = [
	'get',
	'post',
	'put',
	'patch',
	'delete',
	'options',
	'head'
] as const;

export interface PublicOpenApiOperation {
	readonly method: string;
	readonly path: string;
	readonly summary: string;
	readonly operationId?: string;
}

export interface PublicOpenApiGroup {
	readonly operations: readonly PublicOpenApiOperation[];
	readonly tag: string;
}

export interface PublicOpenApiCatalog {
	readonly groups: readonly PublicOpenApiGroup[];
	readonly operationCount: number;
	readonly pathCount: number;
}

export async function fetchPublicOpenApiCatalog(
	options?: FetchOptions
): Promise<PublicOpenApiCatalog> {
	const document = await fetchJson<unknown>('/docs/openapi.json', options);
	return parsePublicOpenApiCatalog(document);
}

export function parsePublicOpenApiCatalog(
	document: unknown
): PublicOpenApiCatalog {
	if (!isRecord(document) || !isRecord(document.paths)) {
		throw new Error('The public OpenAPI document does not contain a paths map');
	}

	const grouped = new Map<string, PublicOpenApiOperation[]>();
	let operationCount = 0;

	for (const [path, pathValue] of Object.entries(document.paths)) {
		if (!isRecord(pathValue)) continue;

		for (const method of HTTP_METHODS) {
			const operationValue = pathValue[method];
			if (!isRecord(operationValue)) continue;

			const operation: PublicOpenApiOperation = {
				method: method.toUpperCase(),
				path,
				summary: readSummary(operationValue, method, path),
				operationId:
					typeof operationValue.operationId === 'string'
						? operationValue.operationId
						: undefined
			};
			const tags = readTags(operationValue);
			for (const tag of tags) {
				const operations = grouped.get(tag) ?? [];
				operations.push(operation);
				grouped.set(tag, operations);
			}
			operationCount += 1;
		}
	}

	const groups = Array.from(grouped, ([tag, operations]) => ({
		operations: operations.toSorted(compareOperations),
		tag
	})).toSorted((left, right) => left.tag.localeCompare(right.tag));

	return {
		groups,
		operationCount,
		pathCount: Object.keys(document.paths).length
	};
}

export function publicOperationTryItUrl(
	operation: PublicOpenApiOperation,
	tag: string
): string {
	return (
		'/api-docs?view=swagger#/' +
		encodeURIComponent(tag) +
		(operation.operationId
			? '/' + encodeURIComponent(operation.operationId)
			: '')
	);
}

function readTags(operation: Record<string, unknown>): readonly string[] {
	const tags = operation.tags;
	if (!Array.isArray(tags)) return ['Other'];

	const values = tags.filter(
		(value): value is string => typeof value === 'string' && value.length > 0
	);
	return values.length > 0 ? values : ['Other'];
}

function readSummary(
	operation: Record<string, unknown>,
	method: string,
	path: string
): string {
	if (typeof operation.summary === 'string' && operation.summary.length > 0) {
		return operation.summary;
	}
	if (
		typeof operation.description === 'string' &&
		operation.description.length > 0
	) {
		return operation.description.split('\n', 1)[0] ?? method + ' ' + path;
	}
	return method.toUpperCase() + ' ' + path;
}

function compareOperations(
	left: PublicOpenApiOperation,
	right: PublicOpenApiOperation
): number {
	const pathOrder = left.path.localeCompare(right.path);
	return pathOrder !== 0 ? pathOrder : left.method.localeCompare(right.method);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
