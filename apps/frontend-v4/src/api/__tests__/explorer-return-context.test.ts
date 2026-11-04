import {
	sanitizeExplorerReturnTo,
	withAssetCatalogueReturnTo,
	withExplorerReturnTo
} from '../explorer-return-context';

const base = 'https://explorer.invalid';
const activity = '/explorer/assets/USDC%3AGA?tab=transfers&asset_activity_after=page_2';
const tx = '/explorer/transactions/' + 'a'.repeat(64) + '?ledger_sequence=121';
const withRawReturn = (href: string, origin: string) => href + '&return_to=' + encodeURIComponent(origin);

describe('explorer return context', () => {
	it('allows an explicit collection journey without changing default collection links or nesting/external return paths', () => {
		const result = withExplorerReturnTo('/explorer/assets?issuer=GA&return_to=%2Funsafe', '/explorer/accounts/GA?return_to=%2Fnested#ignored', true);
		const url = new URL(result, 'https://explorer.invalid');
		expect(url.searchParams.get('issuer')).toBe('GA');
		expect(url.searchParams.get('return_to')).toBe('/explorer/accounts/GA');
		expect(withExplorerReturnTo('/explorer/assets?issuer=GA&return_to=%2Funsafe', '//evil.test', true)).toBe('/explorer/assets?issuer=GA');
		expect(withExplorerReturnTo('//evil.test/explorer/assets', '/explorer', true)).toBe('//evil.test/explorer/assets');
	});
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

	it('allows one Transfers-to-catalogue hop and never carries an inner return chain', () => {
		const catalogue = '/explorer/assets?symbol=USDC&cursor=page_3';
		const fromCatalogue = withAssetCatalogueReturnTo(activity, withRawReturn(catalogue, '/explorer?search=old') + '#ignored');
		expect(new URL(fromCatalogue, base).searchParams.get('return_to')).toBe(catalogue);
		const destination = new URL(withExplorerReturnTo(tx, fromCatalogue), base);
		expect(destination.searchParams.get('ledger_sequence')).toBe('121');
		expect(sanitizeExplorerReturnTo(destination.searchParams.get('return_to'))).toBe(fromCatalogue);
		expect(sanitizeExplorerReturnTo(withRawReturn(activity.replace('tab=transfers', 'tab=markets'), catalogue))).not.toContain('return_to');
	});

	it.each([
		'https://evil.invalid/explorer/assets',
		'//evil.invalid/explorer/assets',
		'/explorer/assets/another',
		'/explorer/assets?symbol=%0a',
		'/explorer/assets?symbol=%zz',
		'/explorer/assets?cursor=' + 'x'.repeat(4096)
	])('does not carry unsafe or unrelated catalogue context (%#.0s)', (invalid) => {
		expect(withAssetCatalogueReturnTo(activity, invalid)).toBe(activity);
		const raw = withRawReturn(activity, invalid);
		expect([activity, null]).toContain(sanitizeExplorerReturnTo(raw));
	});

	it('drops an ambiguous nested catalogue and falls back to catalogue before URL growth exceeds the bound', () => {
		const catalogue = '/explorer/assets?symbol=USDC&cursor=' + 'x'.repeat(2048);
		expect(sanitizeExplorerReturnTo(withRawReturn(withRawReturn(activity, catalogue), '/explorer/assets'))).toBe(activity);
		const largeActivity = activity + 'y'.repeat(2048);
		expect(withAssetCatalogueReturnTo(largeActivity, catalogue)).toBe(catalogue);
		const almostFull = withAssetCatalogueReturnTo(activity + 'y'.repeat(1890), catalogue);
		expect(new URL(almostFull, base).searchParams.get('return_to')).toBe(catalogue);
		const destination = withExplorerReturnTo(tx, almostFull);
		expect(destination.length).toBeLessThanOrEqual(4096);
		expect(new URL(destination, base).searchParams.get('return_to')).toBe(catalogue);
	});
});
