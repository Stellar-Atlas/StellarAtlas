import type { Root, Node } from 'fumadocs-core/page-tree';
export interface DocsSearchItem {
	readonly title: string;
	readonly url: string;
	readonly section: string;
	readonly keywords: string;
}
export function collectDocsSearchItems(
	tree: Root,
	operations: readonly {
		url: string;
		path: string;
		method: string;
		description: string;
	}[] = []
): DocsSearchItem[] {
	const items = new Map<string, DocsSearchItem>();
	function visit(nodes: Node[], parents: string[]): void {
		for (const node of nodes) {
			const name = typeof node.name === 'string' ? node.name : '';
			if (node.type === 'folder') visit(node.children, [...parents, name]);
			if (
				node.type === 'page' &&
				node.url.startsWith('/docs') &&
				!items.has(node.url)
			) {
				items.set(node.url, {
					title: name,
					url: node.url,
					section: parents.filter(Boolean).join(' / '),
					keywords: operations
						.filter((operation) => operation.url === node.url)
						.map(
							(operation) =>
								operation.method +
								' ' +
								operation.path +
								' ' +
								operation.description
						)
						.join(' ')
				});
			}
		}
	}
	visit(tree.children, []);
	return [...items.values()];
}
export function searchDocs(
	items: readonly DocsSearchItem[],
	query: string
): DocsSearchItem[] {
	const terms = query
		.trim()
		.toLocaleLowerCase('en')
		.split(/\s+/)
		.filter(Boolean);
	return items
		.map((item) => ({
			item,
			text: (
				item.title +
				' ' +
				item.section +
				' ' +
				item.url +
				' ' +
				item.keywords
			).toLocaleLowerCase('en')
		}))
		.filter(({ text }) => terms.every((term) => text.includes(term)))
		.sort((a, b) => {
			const score = (item: DocsSearchItem) =>
				terms.reduce(
					(n, term) =>
						n + (item.title.toLocaleLowerCase('en').includes(term) ? 1 : 0),
					0
				);
			return (
				score(b.item) - score(a.item) ||
				a.item.title.localeCompare(b.item.title, 'en')
			);
		})
		.slice(0, 20)
		.map(({ item }) => item);
}
