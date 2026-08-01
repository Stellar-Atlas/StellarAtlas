import {
	defaultExplorerTransactionFreshnessWindowMs,
	parseExplorerTransactionFreshnessWindowMs
} from '../ExplorerConfig.js';

describe('ExplorerConfig', () => {
	it('uses a five-minute transaction freshness window by default', () => {
		expect(
			parseExplorerTransactionFreshnessWindowMs(undefined)._unsafeUnwrap()
		).toBe(defaultExplorerTransactionFreshnessWindowMs);
	});

	it('accepts a bounded explicit transaction freshness window', () => {
		expect(
			parseExplorerTransactionFreshnessWindowMs('120000')._unsafeUnwrap()
		).toBe(120_000);
	});

	it.each(['0', '999', '86400001', '1.5', 'five-minutes'])(
		'rejects invalid transaction freshness window %s',
		(value) => {
			expect(parseExplorerTransactionFreshnessWindowMs(value).isErr()).toBe(
				true
			);
		}
	);
});
