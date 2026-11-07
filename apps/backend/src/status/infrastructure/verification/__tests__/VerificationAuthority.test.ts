import { Keypair, Networks } from '@stellar/stellar-sdk';
import { jest } from '@jest/globals';
import {
	authorityFromRecord,
	createAuthorityReader
} from '../VerificationAuthority.js';
const address = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 7)).publicKey();
const now = new Date('2026-11-07T23:00:00.000Z');
const account = {
	account_id: address,
	last_modified_ledger: 100,
	thresholds: { low_threshold: 0, med_threshold: 0, high_threshold: 0 },
	signers: [{ key: address, weight: 1, type: 'ed25519_public_key' }]
};
const response = (value: unknown, headers: Record<string, string> = {}) =>
	new Response(JSON.stringify(value), {
		headers: { 'Content-Type': 'application/json', ...headers }
	});
it('requires a positive threshold even when ledger thresholds are zero and rejects unsupported or duplicate signers', () => {
	expect(
		authorityFromRecord(account, 'mainnet', address, 100, now).threshold
	).toBe(1);
	for (const signers of [
		[{ ...account.signers[0], type: 'sha256_hash' }],
		[...account.signers, ...account.signers]
	])
		expect(() =>
			authorityFromRecord({ ...account, signers }, 'mainnet', address, 100, now)
		).toThrow();
});
it('binds current signers to network metadata and the actual account response ledger using bounded existing JSON reads', async () => {
	const transport = jest
		.fn<typeof fetch>()
		.mockResolvedValueOnce(
			response({
				network_passphrase: Networks.PUBLIC,
				history_latest_ledger: 100
			})
		)
		.mockResolvedValueOnce(response(account, { 'Latest-Ledger': '100' }))
		.mockResolvedValueOnce(
			response({ sequence: 100, closed_at: now.toISOString() })
		);
	const read = createAuthorityReader(
		new Map([['mainnet', 'https://horizon.example.org/']]),
		transport,
		() => now
	);
	expect(await read('mainnet', address)).toMatchObject({
		ledger: 100,
		address,
		network: 'mainnet',
		threshold: 1
	});
	expect(transport).toHaveBeenCalledTimes(3);
	for (const call of transport.mock.calls) {
		expect(call[1]?.redirect).toBe('error');
		expect(call[1]?.cache).toBe('no-store');
		expect(call[1]?.signal).toBeDefined();
	}
});
it.each(['wrong_network', 'missing_ledger', 'stale_ledger'])(
	'does not verify %s authority evidence',
	async (failure) => {
		const transport = jest
			.fn<typeof fetch>()
			.mockResolvedValueOnce(
				response({
					network_passphrase:
						failure === 'wrong_network' ? Networks.TESTNET : Networks.PUBLIC,
					history_latest_ledger: 100
				})
			)
			.mockResolvedValueOnce(
				response(
					account,
					failure === 'missing_ledger' ? {} : { 'Latest-Ledger': '100' }
				)
			)
			.mockResolvedValueOnce(
				response({ sequence: 100, closed_at: '2026-11-07T22:59:29.000Z' })
			);
		const read = createAuthorityReader(
			new Map([['mainnet', 'https://horizon.example.org/']]),
			transport,
			() => now
		);
		await expect(read('mainnet', address)).rejects.toMatchObject({
			status: 503
		});
	}
);
