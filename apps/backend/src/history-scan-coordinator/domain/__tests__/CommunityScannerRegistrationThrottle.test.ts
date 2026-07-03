import {
	communityScannerRegistrationThrottlePolicy,
	getCommunityScannerRegistrationRetryAfterSeconds,
	hashCommunityScannerRegistrationSource,
	isCommunityScannerRegistrationThrottled
} from '../CommunityScannerRegistrationThrottle.js';

describe('CommunityScannerRegistrationThrottle', () => {
	it('should define bounded registration throttle retention policy', () => {
		expect(communityScannerRegistrationThrottlePolicy).toEqual({
			maxAttempts: 5,
			windowMs: 60 * 60 * 1000,
			retentionMs: 7 * 24 * 60 * 60 * 1000,
			cleanupBatchSize: 100
		});
	});

	it('should hash normalized registration sources without returning raw IPs', () => {
		expect(hashCommunityScannerRegistrationSource(' 203.0.113.44 ')).toBe(
			hashCommunityScannerRegistrationSource('203.0.113.44')
		);
		expect(hashCommunityScannerRegistrationSource('ABC')).toBe(
			hashCommunityScannerRegistrationSource('abc')
		);
		expect(hashCommunityScannerRegistrationSource('203.0.113.44')).toMatch(
			/^[0-9a-f]{64}$/
		);
		expect(hashCommunityScannerRegistrationSource('203.0.113.44')).not.toContain(
			'203.0.113.44'
		);
	});

	it('should allow attempts at the limit and throttle attempts above it', () => {
		expect(
			isCommunityScannerRegistrationThrottled({
				attemptCount: 5,
				windowStartedAt: new Date('2026-07-03T12:00:00.000Z')
			})
		).toBe(false);
		expect(
			isCommunityScannerRegistrationThrottled({
				attemptCount: 6,
				windowStartedAt: new Date('2026-07-03T12:00:00.000Z')
			})
		).toBe(true);
	});

	it('should calculate retry-after seconds from the throttle window', () => {
		expect(
			getCommunityScannerRegistrationRetryAfterSeconds(
				{
					attemptCount: 6,
					windowStartedAt: new Date('2026-07-03T11:30:00.000Z')
				},
				new Date('2026-07-03T12:00:00.000Z')
			)
		).toBe(1800);
	});
});
