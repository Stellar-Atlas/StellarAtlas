import { liquidityPoolOrderBy } from '../HubbleExplorerQuery.js';

describe('historical liquidity-pool order', () => {
	it('applies default trustline descending order with deterministic pool ties', () => {
		expect(liquidityPoolOrderBy()).toEqual([
			{ field: 'trustline_count', direction: 'desc' },
			{ field: 'liquidity_pool_id', direction: 'desc' },
			{ field: '_ledger_sequence', direction: 'desc' },
			{ field: '_row_number', direction: 'desc' },
			{ field: '_batch_id', direction: 'desc' }
		]);
	});

	it('rejects an unsupported order key', () => {
		expect(() => liquidityPoolOrderBy('reserve_c')).toThrow('order_by must be');
	});
});
