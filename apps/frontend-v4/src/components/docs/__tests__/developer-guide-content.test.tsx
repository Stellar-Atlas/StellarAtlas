import { createElement, Fragment } from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import {
	developerGuidePages,
	getDeveloperGuidePage
} from '../developer-guide-content';
import { graphqlAnalyticsExamples } from '../graphql-analytics-examples';

function render(slug: string): string {
	const page = getDeveloperGuidePage(slug);
	if (!page) throw new Error('Missing guide: ' + slug);
	return renderToStaticMarkup(
		createElement(
			Fragment,
			null,
			...page.sections.map((section) =>
				createElement(
					'section',
					{ key: section.id, id: section.id },
					section.content
				)
			)
		)
	);
}
describe('developer guides', () => {
	it('provides six discoverable pages with stable unique section anchors', () => {
		expect(developerGuidePages.map((page) => page.slug)).toEqual([
			'quickstart',
			'datasets',
			'querying',
			'rest',
			'graphql-guide',
			'services'
		]);
		for (const page of developerGuidePages) {
			expect(page.title.length).toBeGreaterThan(0);
			expect(page.description.length).toBeGreaterThan(0);
			expect(new Set(page.sections.map((section) => section.id)).size).toBe(
				page.sections.length
			);
			expect(render(page.slug).length).toBeGreaterThan(200);
		}
		expect(getDeveloperGuidePage('missing')).toBeUndefined();
	});
	it('keeps guide links on known pages and existing interactive tools', () => {
		const document = JSON.parse(
			readFileSync(
				new URL('../../../../generated/public-openapi.json', import.meta.url),
				'utf8'
			)
		) as { paths: Record<string, Record<string, { operationId?: string }>> };
		const operationIds = Object.values(document.paths).flatMap((path) =>
			Object.values(path).flatMap((operation) =>
				operation.operationId ? [operation.operationId] : []
			)
		);
		const allowed = new Set([
			'/docs/graphql',
			'/docs/api',
			...operationIds.map((id) => '/docs/api/' + encodeURIComponent(id)),
			...developerGuidePages.map((page) => '/docs/' + page.slug)
		]);
		for (const page of developerGuidePages)
			for (const match of render(page.slug).matchAll(
				/href="(\/docs\/[^"?#]+)"/g
			))
				expect(allowed.has(match[1]!)).toBe(true);
	});
	it('uses native endpoint links while preserving the raw OpenAPI download', () => {
		const html = developerGuidePages.map((page) => render(page.slug)).join('');
		expect(html).not.toContain('view=swagger');
		expect(html).toContain('/docs/api/listParsedOperations');
		expect(html).toContain('/docs/api/listHubbleDatasets');
		expect(html).toContain('/docs/api/getKnownNodeArchiveEvidence');
		expect(html).toContain('/api-docs/openapi.json');
	});
	it('documents typed representation selection and complete relationship paths', () => {
		const html = render('rest');
		for (const path of [
			'/transactions/{hash}?view=typed',
			'/operations/{id}?view=typed',
			'/trades?view=typed',
			'/contracts/{contractId}/events?view=typed',
			'/assets/{asset}/holders/{account}',
			'/accounts/{account}/effects'
		])
			expect(html).toContain(path);
	});
	it('reuses executable typed GraphQL examples rather than invented schemas', () => {
		const html = render('graphql-guide');
		for (const example of ['operations', 'events', 'balances'] as const) {
			const operation = graphqlAnalyticsExamples[example].query.split('\n')[0]!;
			expect(html).toContain(operation);
		}
		expect(html).toContain('https://api.stellaratlas.io/graphql');
	});
	it('retains the important data and service boundaries', () => {
		expect(render('datasets')).toContain('completedRanges');
		expect(render('datasets')).toContain('not current-chain');
		expect(render('datasets')).toContain('strings or null');
		expect(render('querying')).toContain('not a frozen warehouse snapshot');
		expect(render('services')).toContain(
			'not promise full Hubble feature parity'
		);
		expect(render('services')).toContain(
			'not an alternate URL for the ClickHouse'
		);
		expect(render('services')).toContain('https://api.stellaratlas.io/rpc');
	});
});
