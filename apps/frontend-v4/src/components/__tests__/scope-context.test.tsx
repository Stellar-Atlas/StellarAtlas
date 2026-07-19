/// <reference types="jest" />

import { renderToStaticMarkup } from 'react-dom/server';
import { ScopeContext } from '../layout/scope-context';

describe('scope context', () => {
	it('labels quorum analysis as the current validating network', () => {
		const markup = renderToStaticMarkup(
			<ScopeContext kind="quorum" scope="current-network" />
		);

		expect(markup).toContain('data-network-scope="current-network"');
		expect(markup).toContain('Quorum scope:');
		expect(markup).toContain(
			'<data value="current-network">Current validating network</data>'
		);
	});

	it('uses the selected canonical inventory scope', () => {
		const markup = renderToStaticMarkup(
			<ScopeContext kind="node-inventory" scope="archived" />
		);

		expect(markup).toContain('data-inventory-kind="nodes"');
		expect(markup).toContain('data-inventory-scope="archived"');
		expect(markup).toContain(
			'<data value="archived">Archived / inactive</data>'
		);
	});

	it('separates all-known inventory context from record scope', () => {
		const markup = renderToStaticMarkup(
			<ScopeContext kind="organization-record" scope="current" />
		);

		expect(markup).toContain('data-inventory-scope="all-known"');
		expect(markup).toContain('data-record-kind="organization"');
		expect(markup).toContain('data-record-scope="current"');
		expect(markup).toContain('<data value="all-known">All known</data>');
		expect(markup).toContain(
			'<data value="current">Current organization</data>'
		);
	});
});
