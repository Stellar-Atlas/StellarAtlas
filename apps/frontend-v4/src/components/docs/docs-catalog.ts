import type { Root, Node } from 'fumadocs-core/page-tree';
import document from '../../../generated/public-openapi.json';
import { developerGuidePages } from './developer-guide-content';
import {
	collectDocsOperations,
	type DocsOperation
} from './docs-operation-model';

export { type DocsOperation } from './docs-operation-model';
export const publicApiDocument = document;
const operations = collectDocsOperations(document);

export async function getDocsOperations(): Promise<DocsOperation[]> {
	return operations;
}

export async function getDocsTree(): Promise<Root> {
	const groups = new Map<string, Node[]>();
	for (const operation of operations) {
		const group = groups.get(operation.group) ?? [];
		group.push({ type: 'page', name: operation.title, url: operation.url });
		groups.set(operation.group, group);
	}
	const preferred = [
		'Transactions',
		'Accounts & balances',
		'Assets',
		'Transfers',
		'Operations',
		'Trades & offers',
		'Contracts & events',
		'Ledgers',
		'Dataset queries',
		'GraphQL'
	];
	const order = (name: string) => {
		const index = preferred.indexOf(name);
		return index < 0 ? preferred.length : index;
	};
	const resourceGroups: Node[] = [...groups]
		.sort(([a], [b]) => order(a) - order(b) || a.localeCompare(b, 'en'))
		.map(([name, children]) => ({
			type: 'folder',
			name,
			children
		}));
	return {
		name: 'StellarAtlas documentation',
		children: [
			{ type: 'page', name: 'Introduction', url: '/docs' },
			{ type: 'separator', name: 'Guides' },
			...developerGuidePages.map((page): Node => ({
				type: 'page',
				name: page.title,
				url: '/docs/' + page.slug
			})),
			{ type: 'separator', name: 'Tools' },
			{ type: 'page', name: 'GraphQL explorer', url: '/docs/graphql' },
			{ type: 'page', name: 'Endpoint directory', url: '/docs/api' },
			{ type: 'separator', name: 'REST API reference' },
			...resourceGroups
		]
	};
}
