import {
	buildEntityApiPath,
	buildEntityHref,
	parseEntityPage
} from '../explorer-analytics';
import {
	explorerRouteFilters,
	resolveExplorerSearch,
	normalizeExplorerTimes
} from '../explorer-search-route';
describe('explorer entity routes', () => {
	it('routes identifiers without losing large operation precision', () => {
		expect(resolveExplorerSearch('272689036992143361')).toBe(
			'/explorer/operations/272689036992143361'
		);
		expect(resolveExplorerSearch('63490364')).toBe(
			'/explorer/ledgers/63490364'
		);
		expect(resolveExplorerSearch('C' + 'A'.repeat(55))).toBe(
			'/explorer/contracts/' + 'C' + 'A'.repeat(55)
		);
		expect(resolveExplorerSearch('native')).toBe('/explorer/assets/native');
		expect(resolveExplorerSearch('not an identifier')).toBeNull();
	});
	it('uses typed dynamic endpoints and preserves filters across links', () => {
		expect(
			buildEntityApiPath('operations', '272689036992143361', {})
		).toContain('view=typed');
		expect(
			buildEntityApiPath(
				'trades',
				undefined,
				{ seller: 'GABC', min_ledger: '63490364' },
				25
			)
		).toContain('offset=25');
		expect(
			buildEntityHref('assets', 'USD:GABC', {
				min_ledger: '4',
				max_ledger: '5'
			})
		).toBe('/explorer/assets/USD%3AGABC?min_ledger=4&max_ledger=5');
		expect(
			explorerRouteFilters({
				seller: 'GABC',
				sql: 'DROP',
				offset: ['0', '9'],
				max_ledger: '5'
			})
		).toEqual({ seller: 'GABC', max_ledger: '5' });
	});
	it('rejects missing response metadata and malformed pagination', () => {
		expect(() => parseEntityPage({ rows: [] })).toThrow('ledger window');
		expect(() =>
			parseEntityPage({
				window: { minLedger: 1, maxLedger: 2 },
				offset: 25,
				nextOffset: 10,
				rows: []
			})
		).toThrow('pagination');
		expect(
			parseEntityPage({
				window: { minLedger: 1, maxLedger: 2 },
				record: { id: 'native' },
				coverageStatus: 'partial_or_unknown'
			}).rows
		).toEqual([{ id: 'native' }]);
	});
	it('uses the explicit timezone and rejects malformed date filters', () => {
		expect(
			normalizeExplorerTimes({ start_time: '2026-09-05T18:00:00-04:00' })
				.start_time
		).toBe('2026-09-05T22:00:00.000Z');
		expect(() => normalizeExplorerTimes({ end_time: 'bad' })).toThrow(
			'valid date'
		);
	});
});
