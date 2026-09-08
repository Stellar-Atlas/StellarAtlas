import { readFileSync } from 'node:fs';

const nodeCss = readFileSync(
	new URL('../node-detail.css', import.meta.url),
	'utf8'
);
const themeCss = readFileSync(
	new URL('../../../app/globals.css', import.meta.url),
	'utf8'
);

function luminance(hex: string): number {
	const rgb = [0, 2, 4].map((index) => {
		const value = parseInt(hex.slice(index, index + 2), 16) / 255;
		return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
	});
	return rgb[0]! * 0.2126 + rgb[1]! * 0.7152 + rgb[2]! * 0.0722;
}

describe('node trust graph toolbar contrast', () => {
	it('overrides the legacy light toolbar only within the node trust graph', () => {
		const rule = nodeCss.match(
			/\.node-trust-graph \.graph-toolbar\s*\{([^}]+)\}/
		)?.[1];
		expect(rule).toBeDefined();
		expect(rule).toMatch(/background:\s*var\(--panel\)/);
		expect(rule).toMatch(/color:\s*var\(--ink\)/);
		expect(rule).not.toMatch(/#[0-9a-f]+/i);
	});

	it.each([':root', "html[data-theme='light']"])(
		'has readable title and count contrast for %s',
		(selector) => {
			const start = themeCss.indexOf(selector + ' {');
			expect(start).toBeGreaterThanOrEqual(0);
			const rule = themeCss.slice(start, themeCss.indexOf('}', start));
			const panel = rule.match(/--panel:\s*#([0-9a-f]{6})/i)?.[1];
			const ink = rule.match(/--ink:\s*#([0-9a-f]{6})/i)?.[1];
			expect(panel).toBeDefined();
			expect(ink).toBeDefined();
			const values = [luminance(panel!), luminance(ink!)].sort((a, b) => b - a);
			expect((values[0]! + 0.05) / (values[1]! + 0.05)).toBeGreaterThanOrEqual(
				4.5
			);
		}
	);
});
