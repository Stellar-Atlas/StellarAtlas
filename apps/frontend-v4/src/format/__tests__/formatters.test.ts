import { formatPercent } from '../formatters';

describe('formatPercent', () => {
	it.each([99.95, 99.99, 99.999999, 99.99999999999999])(
		'does not display an exact 100 percent for measured %s',
		(value) => {
			expect(formatPercent(value)).toBe('>99.9%');
		}
	);

	it.each([
		[100, '100%'],
		[0, '0.0%'],
		[98, '98.0%'],
		[98.76, '98.8%'],
		[99.9, '99.9%'],
		[99.94, '99.9%']
	] as const)('preserves ordinary formatting for %s', (value, expected) => {
		expect(formatPercent(value)).toBe(expected);
	});
});
