import { createElement, Fragment } from 'react';
import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import {
	developerGuidePages,
	getDeveloperGuidePage
} from '../developer-guide-content';
import { graphqlAnalyticsExamples } from '../graphql-analytics-examples';
import { saveRestPage } from '../save-rest-page-example';
import { contractEventExample } from '../../blockchain/contract-event-query';
import { contractActivityPath } from '../../../api/explorer-contract-activity';

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
	it('adds offline local-file inspection without duplicating history discovery', () => {
		const section = getDeveloperGuidePage('services')?.sections.find(
			(value) => value.id === 'history-downloads'
		);
		expect(section).toBeDefined();
		const html = renderToStaticMarkup(
			createElement(Fragment, null, section!.content)
		);
		for (const text of [
			'offline-parquet-inspection',
			'scripts/inspect_history_parquet.py',
			'PyArrow 26.0.0',
			'/path/to/complete-ledgers.parquet',
			'/path/to/selected-output.json --preview 5',
			'exact decimal strings',
			'2^53',
			'installs nothing',
			'separate from embedded metadata'
		])
			expect(html).toContain(text);
		expect((html.match(/curl --fail-with-body/g) ?? []).length).toBe(2);
		expect(html).toContain('A byte range cannot validate');
	});
	it.each([
		{
			id: 'inspect-coverage',
			command:
				"curl --fail-with-body --connect-timeout 5 --max-time 30 'https://api.stellaratlas.io/v1/analytics/datasets'"
		},
		{
			id: 'fetch-operations',
			command: saveRestPage(
				'/v1/operations?min_ledger=63490364&max_ledger=63490365&type=payment&limit=10&offset=0',
				'operations-page-1.json',
				undefined,
				30,
				true
			)
		},
		{
			id: 'follow-results',
			command: `offset=$(jq -er '.nextOffset // empty' operations-page-1.json) &&
curl --fail-with-body --connect-timeout 5 --max-time 30 --get 'https://api.stellaratlas.io/v1/operations?min_ledger=63490364&max_ledger=63490365&type=payment&limit=10' \\
  --data-urlencode "offset=$offset"`
		}
	])('renders the exact bounded Quickstart $id command', ({ id, command }) => {
		const section = getDeveloperGuidePage('quickstart')?.sections.find(
			(value) => value.id === id
		);
		expect(section).toBeDefined();
		const html = renderToStaticMarkup(
			createElement(Fragment, null, section!.content)
		);
		const expected = renderToStaticMarkup(
			createElement('code', null, command)
		).slice('<code>'.length, -'</code>'.length);
		expect(html.match(/<pre\b[^>]*><code\b[^>]*>([\s\S]*?)<\/code>/)?.[1]).toBe(
			expected
		);
		expect(command).not.toContain('--retry');
	});
	it('explains local deadline and saved-page boundaries', () => {
		const html = render('quickstart');
		for (const text of [
			'five seconds to connect and thirty seconds for the whole request',
			'without automatic retries',
			'not evidence that rows are absent or that server work stopped',
			'existing file is from a previous run',
			'before using the file in step 3',
			'Continue only after a successful response'
		])
			expect(html).toContain(text);
	});
	it('provides discoverable pages with stable unique section anchors', () => {
		expect(developerGuidePages.map((page) => page.slug)).toEqual([
			'quickstart',
			'datasets',
			'querying',
			'rest',
			'contract-events',
			'contract-verification',
			'assets-and-issuers',
			'live-updates',
			'graphql-guide',
			'services',
			'sdk-plan'
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
	it('connects the shared first-page example to response interpretation and a guarded second request', () => {
		const page = getDeveloperGuidePage('contract-events')!;
		expect(page.sections[0]!.id).toBe('try-events');
		expect(page.sections.at(-1)!.id).toBe('build-provenance');
		const html = render('contract-events');
		const path = contractActivityPath(
			contractEventExample.contract_id,
			'events',
			contractEventExample
		).replaceAll('&', '&amp;');
		expect(html.split(path)).toHaveLength(3);
		for (const text of [
			'page-1.json',
			'page-2.json',
			'summary.total',
			'nextCursor | strings',
			'curl -q --fail-with-body --connect-timeout 5 --max-time 70',
			'--data-urlencode',
			'after=$after',
			'/docs/querying',
			'/docs/live-updates'
		])
			expect(html).toContain(text);
		expect(html).toContain(
			graphqlAnalyticsExamples.events.query.split('\n')[0]!
		);
		const live = render('live-updates');
		for (const text of [
			'https://stellaratlas.io',
			'not a general cross-origin',
			'not a replayable event log',
			'graphql-ws'
		])
			expect(live).toContain(text);
	});
	it('documents the working contract event workflow without conflating events with successful transfers', () => {
		const html = render('contract-events');
		for (const value of [
			'/explorer/contract-events',
			'/docs/api/listAnalyticsContractEvents',
			'nextCursor',
			'input.after',
			'topicsJson',
			'in_successful_contract_call',
			'not automatically a token transfer'
		])
			expect(html).toContain(value);
		expect(html).toContain('hubbleContractEvents');
	});
});
