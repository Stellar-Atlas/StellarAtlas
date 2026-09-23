export interface DocsOperation {
	readonly id: string;
	readonly title: string;
	readonly description: string;
	readonly path: string;
	readonly method:
		'get' | 'post' | 'put' | 'patch' | 'delete' | 'head' | 'options';
	readonly group: string;
	readonly url: string;
}
const methods = [
	'get',
	'post',
	'put',
	'patch',
	'delete',
	'head',
	'options'
] as const;
const record = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

export function operationGroup(path: string, tag: string): string {
	if (path === '/graphql') return 'GraphQL';
	if (!path.startsWith('/v1/analytics')) return tag || 'Other public endpoints';
	if (path.includes('/contracts') || path.includes('/events'))
		return 'Contracts & events';
	if (path.includes('/trades') || path.includes('/offers'))
		return 'Trades & offers';
	if (path.includes('/assets')) return 'Assets';
	if (path.includes('/balances') || path.includes('/accounts'))
		return 'Accounts & balances';
	if (path.includes('/transfers')) return 'Transfers';
	if (path.includes('/transactions')) return 'Transactions';
	if (path.includes('/operations')) return 'Operations';
	if (path.includes('/ledgers')) return 'Ledgers';
	return 'Dataset queries';
}

export function collectDocsOperations(document: unknown): DocsOperation[] {
	if (!record(document) || !record(document.paths))
		throw new Error('Invalid public OpenAPI document.');
	const ids = new Set<string>();
	const operations: DocsOperation[] = [];
	for (const [path, item] of Object.entries(document.paths)) {
		if (!record(item)) continue;
		for (const method of methods) {
			const operation = item[method];
			if (!record(operation)) continue;
			const explicitId = operation.operationId;
			const id =
				typeof explicitId === 'string' && explicitId.length
					? explicitId
					: method +
						'-' +
						path.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '');
			if (ids.has(id)) throw new Error('Duplicate public operationId: ' + id);
			ids.add(id);
			const tag =
				Array.isArray(operation.tags) && typeof operation.tags[0] === 'string'
					? operation.tags[0]
					: '';
			operations.push({
				id,
				title:
					typeof operation.summary === 'string' && operation.summary.trim()
						? operation.summary
						: method.toUpperCase() + ' ' + path,
				description:
					typeof operation.description === 'string'
						? operation.description
						: '',
				path,
				method,
				group: operationGroup(path, tag),
				url: '/docs/api/' + encodeURIComponent(id)
			});
		}
	}
	return operations.sort(
		(a, b) =>
			a.group.localeCompare(b.group, 'en') ||
			a.path.localeCompare(b.path, 'en') ||
			a.method.localeCompare(b.method, 'en')
	);
}
