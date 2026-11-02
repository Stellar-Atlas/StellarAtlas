import { jest } from '@jest/globals';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AnalyticsEntityPage } from '../../../api/explorer-analytics';

jest.unstable_mockModule('../explorer-entity.module.css', () => ({ default: {} }));
jest.unstable_mockModule('../explorer-pair-report.module.css', () => ({ default: {} }));
jest.unstable_mockModule('../explorer-entity-table', () => ({ ExplorerEntityTable: () => null }));
const { ExplorerHistoricalPoolTable } = await import('../explorer-historical-pool-table');
const { PairReportSection } = await import('../explorer-pair-report-section');
const ga = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const a = 'USD:' + ga, b = 'USD:GBDVX4VELCDSQ54KQJYTNHXAHFLBCA77ZY2USQBM4CSHTTV7DME7KALE';
const base = { id: 'a'.repeat(64), ledgerSequence: 64877689, closedAt: '2026-11-02T01:00:00Z' };
const row = { ...base, deleted: false, reserveA: 1234.1234567, reserveB: 1e-7, trustlineCount: '9007199254740993' };
const render = (rows: AnalyticsEntityPage['rows'], assetA = a, assetB = b) => renderToStaticMarkup(createElement(ExplorerHistoricalPoolTable, { rows, assetA, assetB }));

it('distinguishes removals and unknown change state without presenting absent reserves as zero', () => {
	const removed = render([{ ...base, deleted: true, reserveA: null, reserveB: null, trustlineCount: null }]);
	expect(removed).toContain('Removed'); expect((removed.match(/>—<\/td>/g) ?? [])).toHaveLength(3);
	expect(removed).not.toContain('>0</td>'); expect(removed).not.toContain('Observed</td>');
	const unknown = render([{ ...base, reserveA: null, reserveB: null, trustlineCount: null }]);
	expect(unknown).toContain('Not recorded'); expect(unknown).not.toContain('Removed');
	const unexpectedRetainedValues = render([{ ...row, deleted: true }]);
	expect(unexpectedRetainedValues).not.toContain('1,234.1234567');
});

it('retains zero versus missing, seven-decimal human units, exact count and observation links', () => {
	const html = render([row, { ...row, id: 'b'.repeat(64), reserveA: 0, reserveB: null }]);
	expect(html).toContain('Observed'); expect(html).toContain('1,234.1234567'); expect(html).toContain('0.0000001');
	expect(html).toContain('9,007,199,254,740,993'); expect(html).toContain('>0</td>'); expect(html).toContain('>—</td>');
	expect(html).toContain('/explorer/ledgers/64877689'); expect(html).toContain('64,877,689');
	expect(html).toContain('min_ledger=64877689&amp;max_ledger=64877689'); expect(html).toContain('<time');
	expect(html).not.toContain('TVL'); expect(html).not.toContain('USD value');
});

it('disambiguates same-symbol issuers and reversed/native reserve orientation from the supplied pair', () => {
	const html = render([row]);
	expect(html).toContain('Reserve A (USD)'); expect(html).toContain('Reserve B (USD)');
	expect(html).toContain(a); expect(html).toContain(b); expect(html).toContain('/explorer/assets/');
	const reverse = render([row], b, 'native');
	expect(reverse).toContain('Asset A:'); expect(reverse).toContain(b); expect(reverse).toContain('XLM (native)');
	expect(reverse).toContain('Reserve B (XLM)');
});

it('keeps partial-history and pagination context in the actual historical report section', () => {
	const page: AnalyticsEntityPage = { entity: 'liquidity-pools', rows: [{ ...base, deleted: true }], limit: 25, offset: 0, nextOffset: 25, window: { minLedger: 64877680, maxLedger: 64877698 }, coverage: {}, coverageStatus: 'partial_or_unknown', semantics: 'Historical changes, not current liquidity.' };
	const html = renderToStaticMarkup(createElement(PairReportSection, { lane: 'pool-a-b', selection: { assetA: a, assetB: b, minLedger: '64877680', maxLedger: '64877698', limit: '25' }, initialPage: page }));
	expect(html).toContain('Partial history'); expect(html).toContain('More available'); expect(html).toContain('Removed');
	expect(html).toContain('Historical native pool changes'); expect(html).toContain('JSON'); expect(html).toContain('Next');
	expect(render([])).toContain('No matching pool observations in the published range.');
});
