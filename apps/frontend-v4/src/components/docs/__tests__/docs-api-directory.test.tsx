import { renderToStaticMarkup } from 'react-dom/server';
import { jest } from '@jest/globals';
import { collectDocsOperations } from '../docs-operation-model';

jest.unstable_mockModule('../docs-api-directory.module.css', () => ({
	default: {}
}));
const { DocsApiDirectory } = await import('../docs-api-directory');

const operations = collectDocsOperations({
	paths: {
		'/v1/analytics/contracts/{contractId}/events': {
			get: { operationId: 'events', summary: 'Contract events' }
		},
		'/v1/analytics/trades': {
			get: { operationId: 'trades', summary: 'Trades' }
		},
		'/v1/nodes': {
			get: { operationId: 'nodes', summary: 'Nodes', tags: ['Nodes'] }
		}
	}
});

describe('documentation resource directory', () => {
	it('makes every generated API section discoverable from the compact landing directory', () => {
		const html = renderToStaticMarkup(
			<DocsApiDirectory operations={operations} collapsible />
		);
		expect(html).toContain('3 of 3 endpoints in 3 sections');
		expect(html.match(/<details/g)).toHaveLength(3);
		expect(html).not.toMatch(/<details[^>]*open/);
		for (const operation of operations) expect(html).toContain(operation.url);
		expect(html).toContain('Find an endpoint');
		expect(html).toContain('Contracts &amp; events');
	});
	it('keeps the dedicated full directory expanded', () => {
		const html = renderToStaticMarkup(
			<DocsApiDirectory operations={operations} />
		);
		expect(html).not.toContain('<details');
		expect(html.match(/<section/g)).toHaveLength(3);
		for (const operation of operations) expect(html).toContain(operation.url);
	});
});
