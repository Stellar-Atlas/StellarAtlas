import { normalizeWarehouseTimestamp } from '../explorer-analytics';
describe('warehouse UTC timestamps', () => {
	it('makes timezone-free ClickHouse timestamps explicitly UTC before browser rendering', () => {
		expect(normalizeWarehouseTimestamp('2026-07-15 16:43:50.123456')).toBe(
			'2026-07-15T16:43:50.123Z'
		);
		expect(normalizeWarehouseTimestamp('2026-07-15 16:43:50')).toBe(
			'2026-07-15T16:43:50.000Z'
		);
		expect(normalizeWarehouseTimestamp('2026-07-15T16:43:50Z')).toBe(
			'2026-07-15T16:43:50Z'
		);
	});
});
