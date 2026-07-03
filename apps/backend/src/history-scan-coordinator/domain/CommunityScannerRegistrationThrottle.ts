import { createHash } from 'node:crypto';

export const communityScannerRegistrationThrottlePolicy = {
	maxAttempts: 5,
	windowMs: 60 * 60 * 1000
} as const;

export interface CommunityScannerRegistrationThrottleSnapshot {
	readonly attemptCount: number;
	readonly windowStartedAt: Date;
}

export interface CommunityScannerRegistrationThrottleRepository {
	recordAttempt: (
		sourceIpHash: string,
		now: Date,
		windowMs: number
	) => Promise<CommunityScannerRegistrationThrottleSnapshot>;
}

export function hashCommunityScannerRegistrationSource(source: string): string {
	return createHash('sha256').update(source.trim().toLowerCase()).digest('hex');
}

export function isCommunityScannerRegistrationThrottled(
	snapshot: CommunityScannerRegistrationThrottleSnapshot,
	maxAttempts: number = communityScannerRegistrationThrottlePolicy.maxAttempts
): boolean {
	return snapshot.attemptCount > maxAttempts;
}

export function getCommunityScannerRegistrationRetryAfterSeconds(
	snapshot: CommunityScannerRegistrationThrottleSnapshot,
	now: Date,
	windowMs: number = communityScannerRegistrationThrottlePolicy.windowMs
): number {
	const resetAt = snapshot.windowStartedAt.getTime() + windowMs;
	const remainingMs = Math.max(0, resetAt - now.getTime());
	return Math.max(1, Math.ceil(remainingMs / 1000));
}
