import { parseCheckpointScanSeedCliOptions as parse } from '../CheckpointScanSeedCliOptions.js';

describe('bounded checkpoint scan seed CLI', () => {
	it('requires explicit execution and defaults to one small chunk', () => {
		expect(() => parse([])).toThrow('Explicit --run');
		expect(parse(['--run'])).toEqual({
			rowLimit: 1_000,
			chunks: 1,
			durationMs: 10_000,
			untilComplete: false
		});
	});
	it('accepts independent finite row, chunk and time limits', () => {
		expect(
			parse(['--run', '--rows=400', '--chunks=3', '--duration-ms=5000'])
		).toEqual({
			rowLimit: 400,
			chunks: 3,
			durationMs: 5000,
			untilComplete: false
		});
	});
	it('requires explicit supervised continuation and keeps the row bound', () => {
		expect(parse(['--run', '--until-complete'])).toEqual({
			rowLimit: 1000,
			chunks: 1,
			durationMs: 10000,
			untilComplete: true
		});
		expect(parse(['--run', '--until-complete', '--rows=500']).rowLimit).toBe(
			500
		);
		expect(() => parse(['--until-complete'])).toThrow('Explicit --run');
	});
	it.each(['--chunks=10', '--duration-ms=10000'])(
		'does not silently ignore finite limit %s in continuous mode',
		(option) => {
			expect(() => parse(['--run', '--until-complete', option])).toThrow(
				'finite run limits'
			);
		}
	);
	it.each([
		'--rows=0',
		'--rows=10001',
		'--rows=-1',
		'--chunks=101',
		'--duration-ms=60001',
		'--forever=1',
		'--rows=1=2',
		'--rows=2.5',
		'--until-complete=true'
	])('rejects unsafe option %s', (option) => {
		expect(() => parse(['--run', option])).toThrow();
	});
	it('rejects duplicate options', () => {
		expect(() => parse(['--run', '--chunks=1', '--chunks=2'])).toThrow(
			'Duplicate'
		);
	});
});
