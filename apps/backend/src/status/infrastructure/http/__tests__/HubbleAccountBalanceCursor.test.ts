import { StrKey } from '@stellar/stellar-sdk';
import { accountBalanceSql } from '../HubbleAccountBalanceQuery.js';
import {
	decodeBalanceCursor,
	encodeBalanceCursor,
	requireBalanceAccount
} from '../HubbleAccountBalanceCursor.js';
const account = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 1));
const issuer = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 2));
describe('account-scoped balance cursor', () => {
	it('filters only account identity early, then checks publication before latest-state aggregation', () => {
		const sql = accountBalanceSql('fixture');
		const prewhere = sql
			.split('\n')
			.filter((line) => line.includes(' PREWHERE '));
		expect(prewhere).toHaveLength(2);
		for (const line of prewhere) {
			expect(line).toContain('PREWHERE account_id = {account:String}');
			expect(line).not.toMatch(/_source_sha256|asset_type|asset_code/);
		}
		expect(sql).toContain('WHERE (_batch_id, _source_sha256) IN');
		expect(sql).toContain('AND (_batch_id, _source_sha256) IN');
	});
	it('roundtrips native and issued keys', () => {
		for (const key of [
			{ kind: 0 as const, code: '', issuer: '' },
			{ kind: 1 as const, code: 'USD', issuer }
		]) {
			expect(
				decodeBalanceCursor(account, encodeBalanceCursor(account, key))
			).toEqual(key);
		}
		expect(decodeBalanceCursor(account, undefined)).toBeNull();
		expect(requireBalanceAccount(account)).toBe(account);
	});
	it.each([
		'',
		'***',
		'a'.repeat(513),
		Buffer.from('{}').toString('base64url'),
		Buffer.from(JSON.stringify([2, account, 0, '', ''])).toString('base64url'),
		Buffer.from(JSON.stringify([1, account, 0, 'USD', ''])).toString(
			'base64url'
		),
		Buffer.from(JSON.stringify([1, account, 1, '', 'bad'])).toString(
			'base64url'
		)
	])('rejects malformed cursor %s', (value) => {
		expect(() => decodeBalanceCursor(account, value)).toThrow(
			'Invalid account-scoped'
		);
	});
	it('rejects other-account and noncanonical base64 encodings', () => {
		const cursor = encodeBalanceCursor(account, {
			kind: 0,
			code: '',
			issuer: ''
		});
		expect(() => decodeBalanceCursor(issuer, cursor)).toThrow();
		expect(() => decodeBalanceCursor(account, cursor + '=')).toThrow();
	});
});
