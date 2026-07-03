import { RadarNetworkSnapshotSourceAdapter } from '../../radar/RadarNetworkSnapshotSourceAdapter.js';
import { parseRadarNetworkComparisonRefreshCliOptions } from '../RadarNetworkComparisonRefreshCliOptions.js';

describe('parseRadarNetworkComparisonRefreshCliOptions', () => {
	it('should use safe defaults', () => {
		expect(parseRadarNetworkComparisonRefreshCliOptions([])).toEqual({
			freshnessMs: 21600000,
			intervalMs: 21600000,
			loop: false,
			radarMaxBytes: RadarNetworkSnapshotSourceAdapter.defaultMaxBytes,
			radarTimeoutMs: RadarNetworkSnapshotSourceAdapter.defaultTimeoutMs
		});
	});

	it('should parse bounded loop and source options', () => {
		expect(
			parseRadarNetworkComparisonRefreshCliOptions([
				'--loop',
				'--freshness-ms=300000',
				'--interval-ms=60000',
				'--radar-max-bytes=256000',
				'--radar-timeout-ms=1000'
			])
		).toEqual({
			freshnessMs: 300000,
			intervalMs: 60000,
			loop: true,
			radarMaxBytes: 256000,
			radarTimeoutMs: 1000
		});
	});

	it('should reject unknown arguments', () => {
		expect(() =>
			parseRadarNetworkComparisonRefreshCliOptions([
				'--radar-url=https://example'
			])
		).toThrow('Unsupported argument: --radar-url=https://example');
	});

	it('should reject unsafe numeric options', () => {
		expect(() =>
			parseRadarNetworkComparisonRefreshCliOptions(['--interval-ms=10'])
		).toThrow('interval-ms must be an integer from 60000 to 604800000');
		expect(() =>
			parseRadarNetworkComparisonRefreshCliOptions(['--freshness-ms=-1'])
		).toThrow('freshness-ms must be an integer from 0 to 604800000');
		expect(() =>
			parseRadarNetworkComparisonRefreshCliOptions(['--radar-timeout-ms=10'])
		).toThrow('radar-timeout-ms must be an integer from 100 to 60000');
		expect(() =>
			parseRadarNetworkComparisonRefreshCliOptions(['--radar-max-bytes=0'])
		).toThrow('radar-max-bytes must be an integer from 1 to 5000000');
	});
});
