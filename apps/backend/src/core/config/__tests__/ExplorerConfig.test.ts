import {
	defaultExplorerTransactionFreshnessWindowMs,
	parseExplorerTransactionFreshnessWindowMs
} from '../ExplorerConfig.js';
import { parseExplorerAccountProviderConfig } from '../ExplorerAccountProviderConfig.js';

it('leaves the account alternate disabled unless an explicit safe operator base is configured', () => {
	expect(parseExplorerAccountProviderConfig(undefined)._unsafeUnwrap()).toBeUndefined();
	expect(parseExplorerAccountProviderConfig('https://horizon.example.org/prefix')._unsafeUnwrap())
		.toEqual({ url: 'https://horizon.example.org/prefix/', hostname: 'horizon.example.org' });
	for (const value of ['', 'http://horizon.example.org', 'https://127.0.0.1', 'https://localhost',
		'https://x.internal', 'https://u:p@horizon.example.org', 'https://horizon.example.org/?x',
		'https://horizon.example.org/#x', 'https://horizon.example.org:8443', 'https://horizon.example.org/..',
		'https://horizon.example.org/%2e%2e', 'https://horizon.example.org//path'])
		expect(parseExplorerAccountProviderConfig(value).isErr()).toBe(true);
});

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
