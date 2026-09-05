import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
	ExplorerBrowseNavigation,
	ExplorerIndexUnavailable,
	ExplorerRequestNotice
} from '../explorer-browse-ui';

describe('explorer browse navigation and recovery', () => {
	it('offers four compact browse sections with one selected section', () => {
		const markup = renderToStaticMarkup(
			createElement(ExplorerBrowseNavigation, {
				active: 'Transactions',
				onChange: () => undefined
			})
		);
		for (const label of ['Transactions', 'Operations', 'Assets', 'Contracts'])
			expect(markup).toContain(label);
		expect(markup.match(/aria-pressed="true"/g)).toHaveLength(1);
		expect(markup).toContain('aria-label="Browse blockchain data"');
	});

	it('explains incomplete indexes with an availability action, not disabled fields', () => {
		const markup = renderToStaticMarkup(
			createElement(ExplorerIndexUnavailable, {
				label: 'Contract',
				loading: false,
				onRetry: () => undefined
			})
		);
		expect(markup).toContain('Contract index not ready');
		expect(markup).toContain(
			'Complete indexed coverage is not currently available'
		);
		expect(markup).toContain('Check availability');
		expect(markup).not.toContain('<input');
	});

	it('exposes a recoverable error and preserves prior result context', () => {
		const markup = renderToStaticMarkup(
			createElement(ExplorerRequestNotice, {
				error: 'Transaction data could not be refreshed.',
				loading: false,
				onRetry: () => undefined
			})
		);
		expect(markup).toContain('role="alert"');
		expect(markup).toContain('Previous results remain visible');
		expect(markup).toContain('Try again');
	});

	it('announces loading independently of existing results', () => {
		const markup = renderToStaticMarkup(
			createElement(ExplorerRequestNotice, {
				error: null,
				loading: true,
				onRetry: () => undefined
			})
		);
		expect(markup).toContain('role="status"');
		expect(markup).toContain('Loading data');
	});
});
