export const claimablePageBytes = 1024 * 1024;
export const claimablePageSize = 25;
export type ClaimableRole = 'claimant' | 'sponsor';

export function isClaimableRole(value: unknown): value is ClaimableRole {
	return value === 'claimant' || value === 'sponsor';
}

export function isClaimableCursor(value: unknown): value is string {
	return typeof value === 'string' && /^[A-Za-z0-9_-]{1,256}$/.test(value);
}
