type JsonRecord = Record<string, unknown>;

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
const privatePathPrefixes = ['/v1/cross-check'];
const privateTags = new Set(['CrossCheck', 'Community scanner operators']);
const operatorTag = 'Archive scanner operators';
const publicArchiveTag = 'Archive verification';

export function createPublicOpenApiDocument(document: unknown): JsonRecord {
	const source = requireRecord(document, 'OpenAPI document');
	const sourcePaths = requireRecord(source.paths, 'OpenAPI paths');
	const usedTags = new Set<string>();
	const paths: JsonRecord = {};

	for (const [path, value] of Object.entries(sourcePaths)) {
		const pathItem = requireRecord(value, `OpenAPI path ${path}`);
		const publicPathItem: JsonRecord = {};
		let operationCount = 0;

		for (const [key, item] of Object.entries(pathItem)) {
			if (!operationMethods.has(key)) {
				publicPathItem[key] = item;
				continue;
			}
			const operation = requireRecord(item, `${key.toUpperCase()} ${path}`);
			if (!isPublicOperation(path, operation)) continue;
			const tags = publicOperationTags(operation.tags);
			for (const tag of tags) usedTags.add(tag);
			publicPathItem[key] = {
				...operation,
				...(tags.length === 0 ? {} : { tags })
			};
			operationCount += 1;
		}

		if (operationCount > 0) paths[path] = publicPathItem;
	}

	const base = Object.fromEntries(
		Object.entries(source).filter(
			([key]) =>
				key !== 'components' &&
				key !== 'paths' &&
				key !== 'security' &&
				key !== 'tags'
		)
	);
	const components = referencedComponents(paths, source.components);
	const tags = publicTags(source.tags, usedTags);

	return {
		...base,
		...(Object.keys(components).length === 0 ? {} : { components }),
		paths,
		...(tags.length === 0 ? {} : { tags })
	};
}

function isPublicOperation(path: string, operation: JsonRecord): boolean {
	if (privatePathPrefixes.some((prefix) => path.startsWith(prefix)))
		return false;
	if (operation['x-internal'] === true) return false;
	const tags = stringArray(operation.tags);
	if (tags.some((tag) => privateTags.has(tag))) return false;
	if (operation.security === undefined) return true;
	return Array.isArray(operation.security) && operation.security.length === 0;
}

function publicOperationTags(value: unknown): readonly string[] {
	return stringArray(value).map((tag) =>
		tag === operatorTag ? publicArchiveTag : tag
	);
}

function publicTags(value: unknown, usedTags: ReadonlySet<string>): unknown[] {
	if (!Array.isArray(value)) return [];
	const tags = value.filter((tag) => {
		const record = readRecord(tag);
		return (
			record !== null &&
			typeof record.name === 'string' &&
			usedTags.has(record.name)
		);
	});
	for (const name of usedTags) {
		if (!tags.some((tag) => readRecord(tag)?.name === name))
			tags.push({ name });
	}
	return tags;
}

function referencedComponents(paths: JsonRecord, value: unknown): JsonRecord {
	const source = readRecord(value);
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
		const category = readRecord(source[reference.category]);
		if (category !== null && reference.name in category) {
			pending.push(...collectComponentReferences(category[reference.name]));
		}
	}

	const components: JsonRecord = {};
	for (const [categoryName, names] of selected) {
		const sourceCategory = readRecord(source[categoryName]);
		if (sourceCategory === null) continue;
		const category: JsonRecord = {};
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
		const record = readRecord(candidate);
		if (record === null) return;
		if (typeof record.$ref === 'string') references.push(record.$ref);
		for (const item of Object.values(record)) visit(item);
	};
	visit(value);
	return references;
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

function stringArray(value: unknown): readonly string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === 'string')
		: [];
}

function requireRecord(value: unknown, label: string): JsonRecord {
	const record = readRecord(value);
	if (record === null) throw new TypeError(`${label} must be an object`);
	return record;
}

function readRecord(value: unknown): JsonRecord | null {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? (value as JsonRecord)
		: null;
}
