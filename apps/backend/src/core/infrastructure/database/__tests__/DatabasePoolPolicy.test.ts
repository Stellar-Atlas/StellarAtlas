import { resolveDatabasePoolPolicy } from '../DatabasePoolPolicy.js';

describe('DatabasePoolPolicy', () => {
	it('uses bounded defaults', () => {
		expect(resolveDatabasePoolPolicy({})).toEqual({
			connectionTimeoutMs: 10_000,
			poolSize: 10
		});
	});

	it('accepts explicit positive decimal integers', () => {
		expect(
			resolveDatabasePoolPolicy({
				DATABASE_CONNECTION_TIMEOUT_MS: '15000',
				DATABASE_POOL_SIZE: '64'
			})
		).toEqual({ connectionTimeoutMs: 15_000, poolSize: 64 });
	});

	it.each(['0', '-1', '1.5', '1e3', '10x', '', '9007199254740992'])(
		'rejects invalid pool size %p',
		(value) => {
			expect(() =>
				resolveDatabasePoolPolicy({ DATABASE_POOL_SIZE: value })
			).toThrow(/DATABASE_POOL_SIZE/);
		}
	);

	it.each(['0', '-1', '1.5', '1e3', '10x', '', '9007199254740992'])(
		'rejects invalid connection timeout %p',
		(value) => {
			expect(() =>
				resolveDatabasePoolPolicy({
					DATABASE_CONNECTION_TIMEOUT_MS: value
				})
			).toThrow(/DATABASE_CONNECTION_TIMEOUT_MS/);
		}
	);
});
