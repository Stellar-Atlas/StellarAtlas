import { StrKey } from '@stellar/stellar-sdk';
import { HubbleWarehouseInputError } from './HubbleWarehouseErrors.js';

export interface HubbleBalanceCursor {
	readonly kind: 0 | 1;
	readonly code: string;
	readonly issuer: string;
}

export function requireBalanceAccount(account: string): string {
	if (!StrKey.isValidEd25519PublicKey(account))
		throw new HubbleWarehouseInputError(
			'Account must be a checksum-valid Stellar G address'
		);
	return account;
}

export function encodeBalanceCursor(
	account: string,
	key: HubbleBalanceCursor
): string {
	return Buffer.from(
		JSON.stringify([1, account, key.kind, key.code, key.issuer])
	).toString('base64url');
}

export function decodeBalanceCursor(
	account: string,
	cursor: string | undefined
): HubbleBalanceCursor | null {
	if (cursor === undefined) return null;
	const invalid = () =>
		new HubbleWarehouseInputError('Invalid account-scoped balance cursor');
	if (
		cursor.length === 0 ||
		cursor.length > 512 ||
		!/^[A-Za-z0-9_-]+$/.test(cursor)
	)
		throw invalid();
	let value: unknown;
	try {
		const bytes = Buffer.from(cursor, 'base64url');
		if (bytes.toString('base64url') !== cursor) throw invalid();
		value = JSON.parse(bytes.toString('utf8'));
	} catch {
		throw invalid();
	}
	if (
		!Array.isArray(value) ||
		value.length !== 5 ||
		value[0] !== 1 ||
		value[1] !== account ||
		(value[2] !== 0 && value[2] !== 1) ||
		typeof value[3] !== 'string' ||
		typeof value[4] !== 'string'
	)
		throw invalid();
	const kind: 0 | 1 = value[2],
		code: string = value[3],
		issuer: string = value[4];
	if (
		kind === 0
			? code !== '' || issuer !== ''
			: code.length < 1 ||
				code.length > 12 ||
				!StrKey.isValidEd25519PublicKey(issuer)
	)
		throw invalid();
	return { kind, code, issuer };
}
