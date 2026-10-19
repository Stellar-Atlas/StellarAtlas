import {
	sanitizeExplorerReturnTo,
	withExplorerReturnTo
} from '../explorer-return-context';

describe('explorer return context', () => {
	it('accepts explorer-relative paths and removes fragments and nested return_to', () => {
		expect(
			sanitizeExplorerReturnTo(
				'/explorer/assets?code=ABC&return_to=%2Fexplorer%2Fassets#top'
			)
		).toBe('/explorer/assets?code=ABC');
		expect(sanitizeExplorerReturnTo('/explorer')).toBe('/explorer');
	});

	it('rejects external, malformed, oversized, and out-of-explorer paths', () => {
		expect(sanitizeExplorerReturnTo('//example.com/explorer')).toBeNull();
		expect(sanitizeExplorerReturnTo('https://example.com/explorer')).toBeNull();
		expect(sanitizeExplorerReturnTo('/explorer/%2e%2e/admin')).toBeNull();
		expect(sanitizeExplorerReturnTo('/explorer/%zz')).toBeNull();
		expect(sanitizeExplorerReturnTo('/explorer\\contracts')).toBeNull();
		expect(sanitizeExplorerReturnTo('/explorer/\u0001')).toBeNull();
		expect(
			sanitizeExplorerReturnTo(`/explorer/${'a'.repeat(4090)}`)
		).toBeNull();
	});

	it('adds a sanitized return path to detail links and preserves existing query parameters', () => {
		const result = withExplorerReturnTo(
			'/explorer/assets/USDC%3AGA?ledger=123&return_to=%2Funsafe',
			'/explorer/assets?firstLedger=10&return_to=%2Fnested#ignored'
		);
		const url = new URL(result, 'https://explorer.invalid');
		expect(url.pathname).toBe('/explorer/assets/USDC%3AGA');
		expect(url.searchParams.get('ledger')).toBe('123');
		expect(url.searchParams.get('return_to')).toBe(
			'/explorer/assets?firstLedger=10'
		);
	});

	it('strips an existing return_to when origin is invalid, and leaves non-detail destinations unchanged', () => {
		expect(
			withExplorerReturnTo(
				'/explorer/contracts/C123?return_to=%2Funsafe',
				'//evil.test'
			)
		).toBe('/explorer/contracts/C123');
		const collection = '/explorer/contracts?limit=25';
		expect(withExplorerReturnTo(collection, '/explorer')).toBe(collection);
	});
});
