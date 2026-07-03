import {
	parseScanSingleArchiveArguments,
	scanSingleArchiveUsage
} from '../verifySingleArchiveArguments.js';

describe('parseScanSingleArchiveArguments', () => {
	it('should parse an explicit bounded scan range', () => {
		const dto = parseScanSingleArchiveArguments([
			'https://history.example.com',
			'0',
			'127',
			'1'
		]);

		expect(dto).toEqual({
			historyUrl: 'https://history.example.com',
			fromLedger: 0,
			toLedger: 127,
			maxConcurrency: 1
		});
	});

	it('should allow omitted concurrency', () => {
		const dto = parseScanSingleArchiveArguments([
			'https://history.example.com',
			'64',
			'127'
		]);

		expect(dto.maxConcurrency).toBeUndefined();
	});

	it('should reject missing range bounds', () => {
		expect(() =>
			parseScanSingleArchiveArguments(['https://history.example.com'])
		).toThrow('fromLedger is required');
	});

	it('should reject invalid integers', () => {
		expect(() =>
			parseScanSingleArchiveArguments([
				'https://history.example.com',
				'0',
				'127',
				'0'
			])
		).toThrow('concurrency must be an integer >= 1');
	});

	it('should reject empty or reversed ranges', () => {
		expect(() =>
			parseScanSingleArchiveArguments([
				'https://history.example.com',
				'127',
				'127'
			])
		).toThrow('toLedger must be greater than fromLedger');
	});

	it('should expose bounded usage text', () => {
		expect(scanSingleArchiveUsage).toContain('<fromLedger> <toLedger>');
	});
});
