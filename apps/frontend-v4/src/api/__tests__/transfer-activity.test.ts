import {
	buildTransferActivityPath,
	formatTransferAmount,
	parseTransferActivityPage
} from '../transfer-activity';

describe('transfer activity client', () => {
	it('uses dynamic account routes and preserves exact values and opaque cursors', () => {
		const path = buildTransferActivityPath(
			{
				account: 'GABC',
				asset: 'USD:GISSUER',
				min_amount_raw: '9007199254740993001'
			},
			'opaque+/='
		);
		expect(
			path.startsWith('/v1/analytics/accounts/GABC/activity/transfers?')
		).toBe(true);
		const params = new URLSearchParams(path.split('?')[1]);
		expect(params.get('asset')).toBe('USD:GISSUER');
		expect(params.get('min_amount_raw')).toBe('9007199254740993001');
		expect(params.get('after')).toBe('opaque+/=');
		expect(params.has('account')).toBe(false);
		expect(params.get('limit')).toBe('25');
		for (const limit of ['25', '50', '100'])
			expect(new URLSearchParams(buildTransferActivityPath({ limit }).split('?')[1]).get('limit')).toBe(limit);
		expect(() => buildTransferActivityPath({ limit: '200' })).toThrow('25, 50 or 100');
	});
	it('uses encoded asset routes and never coerces amount precision', () => {
		expect(new URLSearchParams(buildTransferActivityPath({ account: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF' }).split('?')[1]).get('evidence')).toBe('payment');
		expect(new URLSearchParams(buildTransferActivityPath({ asset: 'native' }).split('?')[1]).has('evidence')).toBe(false);
		expect(buildTransferActivityPath({ asset: 'USD:GISSUER' })).toContain(
			'/assets/USD%3AGISSUER/activity/transfers?'
		);
		expect(formatTransferAmount('9007199254740993123', 7)).toBe(
			'900719925474.0993123'
		);
		expect(formatTransferAmount('10000000', 7)).toBe('1');
		expect(formatTransferAmount('1', 7)).toBe('0.0000001');
		expect(formatTransferAmount('123', null)).toBe('123 raw units');
	});
	it('normalizes explicit date offsets and rejects invalid dates', () => {
		expect(
			buildTransferActivityPath({ start_time: '2026-09-05T18:00:00-04:00' })
		).toContain('2026-09-05T22%3A00%3A00.000Z');
		expect(() => buildTransferActivityPath({ start_time: 'bad' })).toThrow(
			'valid date'
		);
	});
	it('rejects malformed endpoint bodies instead of treating them as empty success', () => {
		expect(() => parseTransferActivityPage({ transfers: [] })).toThrow(
			'invalid transfer'
		);
		expect(() => parseTransferActivityPage(null)).toThrow('invalid transfer');
	});
});
