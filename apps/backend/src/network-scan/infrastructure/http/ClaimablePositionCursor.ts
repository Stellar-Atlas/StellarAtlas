export type ClaimableCursorScope = readonly [
	networkDescriptor: string,
	accountId: string,
	role: 'claimant' | 'sponsor'
];

const maxCursorLength = 1024;

export function supportsClaimableCursorNetwork(descriptor: string): boolean {
	// Leave room for the account, role and maximum-length Horizon row token.
	return Buffer.byteLength(JSON.stringify(descriptor), 'utf8') <= 512;
}

/** These are public scope fields, not credentials or an authorization token. */
export function encodeClaimableCursor(scope: ClaimableCursorScope, rowToken: string): string {
	return Buffer.from(JSON.stringify([2, ...scope, rowToken]), 'utf8').toString('base64url');
}

export function readClaimableCursor(cursor: unknown, scope: ClaimableCursorScope): string | null {
	if (typeof cursor !== 'string' || cursor.length > maxCursorLength ||
		!/^[A-Za-z0-9_-]+$/.test(cursor)) return null;
	try {
		const bytes = Buffer.from(cursor, 'base64url');
		if (bytes.toString('base64url') !== cursor) return null;
		const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
		if (!Array.isArray(value) || value.length !== 5 || value[0] !== 2 ||
			value[1] !== scope[0] || value[2] !== scope[1] || value[3] !== scope[2] ||
			typeof value[4] !== 'string') return null;
		// Accept exactly what we emit, without alternate JSON/Unicode encodings.
		return encodeClaimableCursor(scope, value[4]) === cursor ? value[4] : null;
	} catch {
		return null;
	}
}
