import { assetReportHref, readAssetReportRoute, validateReportQuery, reportDateInput, utcReportDate } from '../asset-report-route';
const account = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const query = {account, metric: 'bought', counter_asset: 'native', start_time: '2026-10-01T00:00:00.123Z', end_time: '2026-11-01T00:00:00Z', min_ledger: '100', max_ledger: '200', order: 'desc'};
const urlFor = () => new URL(assetReportHref('/explorer/assets/native', '?tab=rankings&history_order=asc&return_to=%2Fexplorer', 'native', 'rankings', query, 'eyJ2IjoxfQ', '#activity'), 'https://qa.invalid');
describe('asset report route identity', () => {
	it('round-trips every supported selection and bounded cursor without changing other report or investigation state', () => {
		const url = urlFor();
		expect(readAssetReportRoute(url.searchParams, 'native', 'rankings')).toEqual({query, after: 'eyJ2IjoxfQ', error: null});
		expect(url.searchParams.get('return_to')).toBe('/explorer');
		expect(url.searchParams.get('history_order')).toBe('asc');
		expect(url.hash).toBe('#activity');
		expect(readAssetReportRoute(url.searchParams, 'native', 'balance-history')).toEqual({query: {order: 'asc'}, after: '', error: null});
	});
	it('rejects stale asset/kind/query cursor scopes instead of silently using a wider page', () => {
		const url = urlFor();
		expect(readAssetReportRoute(url.searchParams, 'USD:'+account, 'rankings').error).toMatch(/does not match/);
		url.searchParams.set('rank_metric', 'sold');
		expect(readAssetReportRoute(url.searchParams, 'native', 'rankings').error).toMatch(/does not match/);
	});
	it('rejects malformed/repeated/oversized controls and reversed windows without an unfiltered request', () => {
		for (const search of ['history_account=bad', 'history_order=desc&history_order=asc', 'history_min_ledger=4294967296', 'history_min_ledger=200&history_max_ledger=100', 'history_start_time=not-a-date', 'history_start_time=2026-11-02T00:00:00Z&history_end_time=2026-11-01T00:00:00Z', 'history_after='+ 'a'.repeat(2049)]) {
			expect(readAssetReportRoute(new URLSearchParams(search), 'native', 'balance-history').error).not.toBeNull();
		}
		expect(() => validateReportQuery('rankings', {metric:'unknown'})).toThrow();
		expect(() => validateReportQuery('rankings', {counter_asset:'https://bad.invalid'})).toThrow();
	});
	it('preserves UTC milliseconds through local form display and removes the cursor on Apply', () => {
		expect(utcReportDate(reportDateInput(query.start_time))).toBe(query.start_time);
		const url = urlFor();
		const reset = new URL(assetReportHref(url.pathname, url.search, 'native', 'rankings', query), url);
		expect(reset.searchParams.has('rank_after')).toBe(false);
		expect(reset.searchParams.has('rank_for')).toBe(false);
	});
	it('preserves both UTC instants in a DST fold, including milliseconds and unrelated Apply edits', () => {
		for (const original of ['2026-11-01T05:30:00.123Z','2026-11-01T06:30:00.123Z','2026-07-01T12:34:56.789Z','2026-01-01T12:34:56Z']) {
			const input = reportDateInput(original);
			const end = new Date(Date.parse(original)+3600000).toISOString();
			expect(input).toBe(new Date(original).toISOString().slice(0,23));
			expect(utcReportDate(input,original)).toBe(original);
			for (const changes of [{order:'asc'},{account:'GBDVX4VELCDSQ54KQJYTNHXAHFLBCA77ZY2USQBM4CSHTTV7DME7KALE'}]) {
				const applied = validateReportQuery('rankings',{...query,...changes,start_time:utcReportDate(input,original),end_time:utcReportDate(reportDateInput(end),end)});
				expect(applied.start_time).toBe(original);expect(applied.end_time).toBe(end);expect(applied).toMatchObject(changes);
			}
		}
		expect(reportDateInput('2026-11-01T05:30:00.123Z')).not.toBe(reportDateInput('2026-11-01T06:30:00.123Z'));
	});
	it('interprets edits only as explicitly labelled UTC, never the browser timezone', () => {
		expect(utcReportDate('2026-11-01T06:45:00.321','2026-11-01T06:30:00.123Z')).toBe('2026-11-01T06:45:00.321Z');
		expect(utcReportDate('2026-11-01T06:45')).toBe('2026-11-01T06:45:00.000Z');
		expect(utcReportDate('',query.start_time)).toBe('');
		expect(()=>utcReportDate('2026-11-01T06:45Z')).toThrow();
	});
});
