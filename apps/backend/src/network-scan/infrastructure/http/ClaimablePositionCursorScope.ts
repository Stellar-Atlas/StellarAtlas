import { createHash } from 'node:crypto';

/** v1 fingerprint of public scope fields. It is neither a password hash nor a MAC. */
export function claimablePositionCursorScope(
	networkDescriptor: string,
	accountId: string,
	role: 'claimant' | 'sponsor'
): string {
	const publicScope = JSON.stringify([
		'account-claimable-positions-v1',
		networkDescriptor,
		accountId,
		role
	]);
	return createHash('sha256').update(publicScope, 'utf8').digest('base64url');
}
