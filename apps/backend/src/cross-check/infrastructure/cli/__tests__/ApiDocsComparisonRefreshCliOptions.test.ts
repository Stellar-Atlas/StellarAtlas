import { RadarApiDocsSourceAdapter } from '../../radar/RadarApiDocsSourceAdapter.js';
import { parseApiDocsComparisonRefreshCliOptions } from '../ApiDocsComparisonRefreshCliOptions.js';

describe('parseApiDocsComparisonRefreshCliOptions', () => {
	it('should use safe defaults', () => {
		expect(parseApiDocsComparisonRefreshCliOptions([])).toEqual({
			freshnessMs: 21600000,
			intervalMs: 21600000,
			loop: false,
			radarMaxBytes: RadarApiDocsSourceAdapter.defaultMaxBytes,
			radarTimeoutMs: RadarApiDocsSourceAdapter.defaultTimeoutMs,
			stellarAtlasDocumentationUrl: '/docs'
		});
	});

	it('should parse bounded loop and source options', () => {
		expect(
			parseApiDocsComparisonRefreshCliOptions([
				'--loop',
				'--freshness-ms=300000',
				'--interval-ms=60000',
				'--radar-max-bytes=256000',
				'--radar-timeout-ms=1000',
				'--stellar-atlas-docs-url=/internal-docs'
			])
		).toEqual({
			freshnessMs: 300000,
			intervalMs: 60000,
			loop: true,
			radarMaxBytes: 256000,
			radarTimeoutMs: 1000,
			stellarAtlasDocumentationUrl: '/internal-docs'
		});
	});

	it('should reject unknown arguments', () => {
		expect(() =>
			parseApiDocsComparisonRefreshCliOptions(['--radar-url=https://example'])
		).toThrow('Unsupported argument: --radar-url=https://example');
	});

	it('should reject unsafe numeric options', () => {
		expect(() =>
			parseApiDocsComparisonRefreshCliOptions(['--interval-ms=10'])
		).toThrow('interval-ms must be an integer from 60000 to 604800000');
		expect(() =>
			parseApiDocsComparisonRefreshCliOptions(['--freshness-ms=-1'])
		).toThrow('freshness-ms must be an integer from 0 to 604800000');
		expect(() =>
			parseApiDocsComparisonRefreshCliOptions(['--radar-timeout-ms=10'])
		).toThrow('radar-timeout-ms must be an integer from 100 to 60000');
		expect(() =>
			parseApiDocsComparisonRefreshCliOptions(['--radar-max-bytes=0'])
		).toThrow('radar-max-bytes must be an integer from 1 to 5000000');
		expect(() =>
			parseApiDocsComparisonRefreshCliOptions(['--stellar-atlas-docs-url='])
		).toThrow('stellar-atlas-docs-url must not be empty');
	});
});
