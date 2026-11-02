import { formatMarketAmount, marketAssetLabel } from '../explorer-market-values';

describe('historical market values', () => {
	it('groups supplied decimals without losing large integers or fractional precision', () => {
		expect(formatMarketAmount('12345678901234567890.1234567')).toBe('12,345,678,901,234,567,890.1234567');
		expect(formatMarketAmount('-1234567.0000001')).toBe('-1,234,567.0000001');
		expect(formatMarketAmount('0.0000001')).toBe('0.0000001');
		expect(formatMarketAmount('1200.1000000')).toBe('1,200.1');
		expect(formatMarketAmount('1.123456789')).toBe('1.123456789');
		expect(formatMarketAmount('1e-7')).toBe('1e-7');
		expect(formatMarketAmount('')).toBe('—');
	});
	it('keeps amount units attached to each sold/bought asset rather than assuming a quote', () => {
		expect(marketAssetLabel({ id: 'native' })).toBe('XLM');
		expect(marketAssetLabel({ id: 'KALE:GISSUER', code: 'KALE' })).toBe('KALE');
		expect(marketAssetLabel({ id: 'CUNKNOWN' })).toBe('CUNKNOWN');
		expect(marketAssetLabel(null)).toBe('Unknown asset');
	});
});
