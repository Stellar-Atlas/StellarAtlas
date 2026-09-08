import { jest } from '@jest/globals';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { GraphiQLProps } from 'graphiql';

let received: GraphiQLProps | undefined;
jest.unstable_mockModule('graphiql/setup-workers/webpack', () => ({}));
jest.unstable_mockModule('graphiql/style.css', () => ({}));
jest.unstable_mockModule('../graphql-ide.module.css', () => ({ default: {} }));
jest.unstable_mockModule('graphiql', () => ({
	GraphiQL: Object.assign(
		(props: GraphiQLProps) => {
			received = props;
			return createElement('div', { 'data-testid': 'real-graphiql-slot' });
		},
		{ Logo: () => null }
	)
}));
const { default: GraphqlIde } = await import('../graphql-ide');

describe('schema-driven GraphQL documentation integration', () => {
	it('mounts the official editor with live schema discovery and explicit data execution', () => {
		const html = renderToStaticMarkup(createElement(GraphqlIde));
		expect(html).toContain('GraphQL explorer');
		expect(html).toContain(
			'Schema discovery is automatic; data queries run only on Execute.'
		);
		expect(received?.schema).toBeUndefined();
		expect(received?.fetcher).toEqual(expect.any(Function));
		expect(received?.initialQuery).toContain('hubbleTransfers');
		expect(JSON.parse(received?.initialVariables ?? '{}').input).toMatchObject({
			minLedger: 26000000,
			maxLedger: 26000099,
			limit: 10
		});
		expect(received?.isHeadersEditorEnabled).toBe(false);
		expect(received?.shouldPersistHeaders).toBe(false);
		expect(received?.showPersistHeadersSettings).toBe(false);
		expect(received?.defaultEditorToolsVisibility).toBe('variables');
		expect(received?.customScalarSchemas).toHaveProperty('JSON');
	});
	it('preserves pagination and includes useful typed/aggregate examples without current-state claims', () => {
		const html = renderToStaticMarkup(createElement(GraphqlIde));
		for (const name of [
			'Account balances',
			'Payment operations',
			'Contracts observed',
			'Trades, counterparties',
			'Offer observations',
			'count operations by type',
			'Soroban invocation',
			'Asset holders'
		])
			expect(html).toContain(name);
		expect(html).toContain('Load next page');
		expect(html).toContain('Load previous page');
		expect(html).toContain(
			'not an atomic current or historical as-of snapshot'
		);
		expect(html).not.toContain('textarea');
	});
});
