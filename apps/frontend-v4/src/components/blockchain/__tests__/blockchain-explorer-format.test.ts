import {
	formatExplorerSource,
	formatTransactionSource
} from '../blockchain-explorer-format';

describe('blockchain explorer source labels', () => {
	it('identifies proof-gated canonical transaction data', () => {
		expect(formatTransactionSource('postgres_canonical')).toBe(
			'StellarAtlas canonical history'
		);
		expect(formatExplorerSource('postgres_canonical')).toBe(
			'StellarAtlas canonical history'
		);
	});
});
