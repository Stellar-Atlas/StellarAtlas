import { assetTabHref, assetTabOptions, readAssetTab } from '../asset-tab-route';

describe('asset tab URL state', () => {
	it('restores every supported tab and falls back for unknown values', () => {
		for (const option of assetTabOptions)
			expect(readAssetTab(option.value)).toBe(option.label);
		for (const value of [null, '', 'MARKETS', 'unknown', '__proto__'])
			expect(readAssetTab(value)).toBe('Overview');
	});

	it('changes only the tab and preserves other query values and the anchor', () => {
		const href = assetTabHref('/explorer/assets/native',
			'?q=XLM&min_ledger=10&return_to=%2Fexplorer%2Fassets%3Fq%3DXLM&tag=a&tag=b&tab=holders',
			'Markets', '#activity');
		const url = new URL(href, 'https://explorer.invalid');
		expect(url.pathname).toBe('/explorer/assets/native');
		expect(url.searchParams.get('tab')).toBe('markets');
		expect(url.searchParams.get('return_to')).toBe('/explorer/assets?q=XLM');
		expect(url.searchParams.get('min_ledger')).toBe('10');
		expect(url.searchParams.getAll('tag')).toEqual(['a', 'b']);
		expect(url.hash).toBe('#activity');
	});

	it('uses the default URL for Overview and normalizes duplicate tabs', () => {
		expect(assetTabHref('/explorer/assets/native', '?tab=markets', 'Overview'))
			.toBe('/explorer/assets/native');
		const href = assetTabHref('/explorer/assets/native', '?tab=holders&tab=markets&q=XLM', 'Holders');
		expect(new URL(href, 'https://explorer.invalid').searchParams.getAll('tab')).toEqual(['holders']);
	});
});
