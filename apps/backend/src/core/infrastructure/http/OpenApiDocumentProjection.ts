export type OpenApiRecord = Record<string, unknown>;

export interface OpenApiOperationContext {
	readonly method: string;
	readonly operation: OpenApiRecord;
	readonly path: string;
}

export interface OpenApiProjectionOptions {
	readonly includeOperation: (context: OpenApiOperationContext) => boolean;
	readonly includeSecuritySchemes?: boolean;
	readonly info: OpenApiRecord;
	readonly servers: readonly OpenApiRecord[];
	readonly tags: readonly OpenApiRecord[];
	readonly transformOperation?: (
		context: OpenApiOperationContext
	) => OpenApiRecord;
}

const operationMethods = new Set([
	'delete',
	'get',
	'head',
	'options',
	'patch',
	'post',
	'put',
	'trace'
]);

export function projectOpenApiDocument(
	document: unknown,
	options: OpenApiProjectionOptions
): OpenApiRecord {
	const source = requireOpenApiRecord(document, 'OpenAPI document');
	const sourcePaths = requireOpenApiRecord(source.paths, 'OpenAPI paths');
	const usedTags = new Set<string>();
	const paths: OpenApiRecord = {};

	for (const [path, value] of Object.entries(sourcePaths)) {
		const pathItem = requireOpenApiRecord(value, `OpenAPI path ${path}`);
		const projectedPathItem: OpenApiRecord = {};
		let operationCount = 0;

		for (const [method, item] of Object.entries(pathItem)) {
			if (!operationMethods.has(method)) {
				projectedPathItem[method] = item;
				continue;
			}
			const operation = requireOpenApiRecord(
				item,
				`${method.toUpperCase()} ${path}`
			);
			const context = { method, operation, path };
			if (!options.includeOperation(context)) continue;
			const projectedOperation =
				options.transformOperation?.(context) ?? operation;
			for (const tag of readOpenApiStringArray(projectedOperation.tags)) {
				usedTags.add(tag);
			}
			projectedPathItem[method] = projectedOperation;
			operationCount += 1;
		}

		if (operationCount > 0) paths[path] = projectedPathItem;
	}

	const base = Object.fromEntries(
		Object.entries(source).filter(
			([key]) =>
				key !== 'components' &&
				key !== 'info' &&
				key !== 'paths' &&
				key !== 'security' &&
				key !== 'servers' &&
				key !== 'tags'
		)
	);
	const components = referencedComponents(
		paths,
		source.components,
		options.includeSecuritySchemes === true
	);
	const tags = options.tags.filter((tag) => {
		const name = tag.name;
		return typeof name === 'string' && usedTags.has(name);
	});

	return {
		...base,
		info: {
			...requireOpenApiRecord(source.info, 'OpenAPI info'),
			...options.info
		},
		...(Object.keys(components).length === 0 ? {} : { components }),
		paths,
		servers: options.servers,
		...(tags.length === 0 ? {} : { tags })
	};
}

export function readOpenApiRecord(value: unknown): OpenApiRecord | null {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? (value as OpenApiRecord)
		: null;
}

export function readOpenApiStringArray(value: unknown): readonly string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === 'string')
		: [];
}

function referencedComponents(
	paths: OpenApiRecord,
	value: unknown,
	includeSecuritySchemes: boolean
): OpenApiRecord {
	const source = readOpenApiRecord(value);
	if (source === null) return {};
	const pending = collectComponentReferences(paths);
	const selected = new Map<string, Set<string>>();

	while (pending.length > 0) {
		const reference = parseComponentReference(pending.pop());
		if (reference === null) continue;
		const names = selected.get(reference.category) ?? new Set<string>();
		if (names.has(reference.name)) continue;
		names.add(reference.name);
		selected.set(reference.category, names);
		const category = readOpenApiRecord(source[reference.category]);
		if (category !== null && reference.name in category) {
			pending.push(...collectComponentReferences(category[reference.name]));
		}
	}

	if (includeSecuritySchemes) {
		const names = collectSecuritySchemeNames(paths);
		if (names.size > 0) selected.set('securitySchemes', names);
	}

	const components: OpenApiRecord = {};
	for (const [categoryName, names] of selected) {
		const sourceCategory = readOpenApiRecord(source[categoryName]);
		if (sourceCategory === null) continue;
		const category: OpenApiRecord = {};
		for (const name of names) {
			if (name in sourceCategory) category[name] = sourceCategory[name];
		}
		if (Object.keys(category).length > 0) components[categoryName] = category;
	}
	return components;
}

function collectComponentReferences(value: unknown): string[] {
	const references: string[] = [];
	const visit = (candidate: unknown): void => {
		if (Array.isArray(candidate)) {
			for (const item of candidate) visit(item);
			return;
		}
		const record = readOpenApiRecord(candidate);
		if (record === null) return;
		if (typeof record.$ref === 'string') references.push(record.$ref);
		for (const item of Object.values(record)) visit(item);
	};
	visit(value);
	return references;
}

function collectSecuritySchemeNames(value: unknown): Set<string> {
	const names = new Set<string>();
	const visit = (candidate: unknown): void => {
		if (Array.isArray(candidate)) {
			for (const item of candidate) visit(item);
			return;
		}
		const record = readOpenApiRecord(candidate);
		if (record === null) return;
		if (Array.isArray(record.security)) {
			for (const requirement of record.security) {
				const requirementRecord = readOpenApiRecord(requirement);
				if (requirementRecord !== null) {
					for (const name of Object.keys(requirementRecord)) names.add(name);
				}
			}
		}
		for (const item of Object.values(record)) visit(item);
	};
	visit(value);
	return names;
}

function parseComponentReference(
	value: string | undefined
): { category: string; name: string } | null {
	if (value === undefined) return null;
	const match = /^#\/components\/([^/]+)\/(.+)$/.exec(value);
	if (match === null) return null;
	return {
		category: decodePointerSegment(match[1]!),
		name: decodePointerSegment(match[2]!)
	};
}

function decodePointerSegment(value: string): string {
	return value.replaceAll('~1', '/').replaceAll('~0', '~');
}

function requireOpenApiRecord(value: unknown, label: string): OpenApiRecord {
	const record = readOpenApiRecord(value);
	if (record === null) throw new TypeError(`${label} must be an object`);
	return record;
}
