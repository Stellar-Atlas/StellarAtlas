import { collectDocsSearchItems, searchDocs } from '../docs-search-model';
import type { Root } from 'fumadocs-core/page-tree';
const tree: Root = {
	name: 'Docs',
	children: [
		{ type: 'page', name: 'Quickstart', url: '/docs/quickstart' },
		{
			type: 'folder',
			name: 'Accounts & balances',
			children: [
				{ type: 'page', name: 'List balances', url: '/docs/api/balances' },
				{
					type: 'page',
					name: 'List balances duplicate',
					url: '/docs/api/balances'
				}
			]
		},
		{ type: 'page', name: 'External', url: 'https://example.com' }
	]
};
describe('local developer documentation search', () => {
	it('indexes navigable guides and operations once, without API data', () => {
		expect(collectDocsSearchItems(tree)).toEqual([
			{
				title: 'Quickstart',
				url: '/docs/quickstart',
				section: '',
				keywords: ''
			},
			{
				title: 'List balances',
				url: '/docs/api/balances',
				section: 'Accounts & balances',
				keywords: ''
			}
		]);
	});
	it('matches words across title, group, method and actual endpoint path', () => {
		const items = collectDocsSearchItems(tree, [
			{
				url: '/docs/api/balances',
				path: '/v1/analytics/accounts/{account}/balances',
				method: 'get',
				description: 'Latest ingested observations'
			}
		]);
		expect(searchDocs(items, 'accounts BALANCES')).toHaveLength(1);
		expect(searchDocs(items, 'GET /v1/analytics/accounts')).toHaveLength(1);
		expect(searchDocs(items, 'observations')[0]?.url).toBe(
			'/docs/api/balances'
		);
		expect(searchDocs(items, 'does-not-exist')).toEqual([]);
	});
	it('bounds rendered suggestions without changing the full index', () => {
		const items = Array.from({ length: 100 }, (_, id) => ({
			title: 'Endpoint ' + id,
			url: '/docs/api/' + id,
			section: 'API',
			keywords: ''
		}));
		expect(searchDocs(items, '')).toHaveLength(20);
		expect(items).toHaveLength(100);
	});
});
