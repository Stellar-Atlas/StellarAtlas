import {
	Keypair,
	TransactionBuilder,
	WebAuth,
	Networks
} from '@stellar/stellar-sdk';
import { jest } from '@jest/globals';
import type { Network } from '../VerificationApplication.js';
import type { Request } from 'express';
import {
	VerificationStellarAuth,
	principal,
	tokenHash
} from '../VerificationStellarAuth.js';
import {
	authorityFromRecord,
	type AccountAuthority
} from '../VerificationAuthority.js';
import type {
	AuthenticatedProof,
	IssuedChallenge,
	VerificationAuthStore
} from '../VerificationAuthStore.js';
import { TypeOrmVerificationAuthStore } from '../VerificationAuthStore.js';
import type { DataSource, EntityManager } from 'typeorm';

// Deterministic, test-only keys. These are never production credentials or git signers.
const server = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 9));
const first = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 7));
const second = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 8));
const address = first.publicKey();
const origin = 'https://atlas.example.org';
const request = (token?: string, site = origin) =>
	({
		get: (name: string) =>
			name === 'Origin'
				? site
				: name === 'Authorization' && token
					? 'Bearer ' + token
					: undefined
	}) as unknown as Request;
function fixture() {
	let now = new Date();
	let authority: AccountAuthority = authorityFromRecord(
		{
			account_id: address,
			last_modified_ledger: 100,
			thresholds: { low_threshold: 1, med_threshold: 2, high_threshold: 2 },
			signers: [first, second].map((key) => ({
				key: key.publicKey(),
				type: 'ed25519_public_key',
				weight: 1
			}))
		},
		'mainnet',
		address,
		100,
		now
	);
	const challenges = new Map<string, IssuedChallenge>();
	const proofs = new Map<string, AuthenticatedProof>();
	const store: VerificationAuthStore = {
		async issue(value) {
			challenges.set(value.hash, value);
		},
		async challenge(hash) {
			return challenges.get(hash) ?? null;
		},
		async consume(proof) {
			if (!challenges.delete(proof.hash)) return false;
			proofs.set(proof.hash, proof);
			return true;
		},
		async session(hash) {
			return (
				[...proofs.values()].find((proof) => proof.tokenHash === hash) ?? null
			);
		},
		async proof(hash) {
			return proofs.get(hash) ?? null;
		},
		async revoke(hash) {
			for (const [id, proof] of proofs)
				if (proof.tokenHash === hash) proofs.delete(id);
		},
		admitAuthorityRead: jest.fn(async () => undefined)
	};
	const reviewers = new Set<string>();
	const read = jest.fn(async (_network: Network, _address: string) => ({
		...authority,
		observedAt: now.toISOString()
	}));
	const auth = new VerificationStellarAuth(
		{
			origin,
			homeDomain: 'atlas.example.org',
			server,
			networks: new Set(['mainnet', 'testnet']),
			reviewers
		},
		store,
		read,
		() => now
	);
	return {
		auth,
		store,
		challenges,
		proofs,
		read,
		reviewers,
		setTime(value: Date) {
			now = value;
		},
		setAuthority(value: AccountAuthority) {
			authority = value;
		},
		get authority() {
			return authority;
		}
	};
}
function sign(xdr: string, ...keys: Keypair[]): string {
	const tx = TransactionBuilder.fromXdr(xdr, Networks.PUBLIC);
	tx.sign(...keys);
	return tx.toEnvelope().toXdr('base64');
}
it('builds a domain/network bound, non-executable SDK challenge and authenticates weighted account authority', async () => {
	const f = fixture();
	const challenge = await f.auth.challenge('mainnet', address);
	const decoded = WebAuth.readChallengeTx(
		challenge.transaction,
		server.publicKey(),
		Networks.PUBLIC,
		'atlas.example.org',
		'atlas.example.org'
	);
	expect(decoded.tx.sequence).toBe('0');
	expect(decoded.tx.operations).toHaveLength(2);
	const result = await f.auth.exchange(
		'mainnet',
		sign(challenge.transaction, first, second)
	);
	expect(result.subjectId).toBe(principal('mainnet', address));
	expect(result.token).toHaveLength(43);
	expect([...f.proofs.values()][0]?.tokenHash).toBe(tokenHash(result.token));
	expect(JSON.stringify([...f.proofs.values()])).not.toContain(result.token);
	const req = request(result.token);
	expect(await f.auth.applicant(req)).toEqual({ subjectId: result.subjectId });
	expect(
		await f.auth.control(req, { network: 'mainnet', address }, result.subjectId)
	).toMatchObject({
		method: 'stellar-account-authority',
		reference: expect.stringMatching(/^sep10:[a-f0-9]{64}$/)
	});
	expect(f.read).toHaveBeenCalledTimes(2); // exchange + one request; applicant/control share its check
	expect(await f.auth.reviewer(req)).toBeNull();
	f.reviewers.add(result.subjectId);
	expect(await f.auth.reviewer(request(result.token))).toEqual({
		subjectId: result.subjectId,
		role: 'identity-reviewer'
	});
});
it('rejects insufficient weight, extra unknown signatures and a wrong network without consuming the nonce', async () => {
	const f = fixture();
	const challenge = await f.auth.challenge('mainnet', address);
	await expect(
		f.auth.exchange('mainnet', sign(challenge.transaction, first))
	).rejects.toMatchObject({ status: 401 });
	await expect(
		f.auth.exchange(
			'mainnet',
			sign(
				challenge.transaction,
				first,
				second,
				Keypair.fromRawEd25519Seed(Buffer.alloc(32, 10))
			)
		)
	).rejects.toMatchObject({ status: 401 });
	await expect(
		f.auth.exchange('testnet', sign(challenge.transaction, first, second))
	).rejects.toMatchObject({ status: 401 });
	expect(f.challenges.size).toBe(1);
	expect(f.proofs.size).toBe(0);
});
it('rejects a valid server-signed but unissued challenge and enforces exact expiry without SDK clock leeway', async () => {
	const f = fixture();
	const unknown = WebAuth.buildChallengeTx(
		server,
		address,
		'atlas.example.org',
		300,
		Networks.PUBLIC,
		'atlas.example.org'
	);
	await expect(
		f.auth.exchange('mainnet', sign(unknown, first, second))
	).rejects.toMatchObject({ status: 401 });
	const challenge = await f.auth.challenge('mainnet', address);
	f.setTime(new Date(Date.parse(challenge.expiresAt)));
	await expect(
		f.auth.exchange('mainnet', sign(challenge.transaction, first, second))
	).rejects.toMatchObject({ status: 401 });
});
it('rejects another home domain, future bounds and unsupported account identities', async () => {
	const f = fixture();
	const other = WebAuth.buildChallengeTx(
		server,
		address,
		'other.example.org',
		300,
		Networks.PUBLIC,
		'other.example.org'
	);
	await expect(
		f.auth.exchange('mainnet', sign(other, first, second))
	).rejects.toMatchObject({ status: 401 });
	const challenge = await f.auth.challenge('mainnet', address);
	f.setTime(new Date(Date.now() - 10_000));
	await expect(
		f.auth.exchange('mainnet', sign(challenge.transaction, first, second))
	).rejects.toMatchObject({ status: 401 });
	await expect(
		f.auth.challenge('mainnet', server.publicKey())
	).rejects.toMatchObject({ status: 403 });
	await expect(
		f.auth.challenge('mainnet', 'C' + 'A'.repeat(55))
	).rejects.toMatchObject({ status: 400 });
});
it('consumes a challenge once under concurrent exchange and immediately rejects changed account authority', async () => {
	const f = fixture();
	const challenge = await f.auth.challenge('mainnet', address);
	const signed = sign(challenge.transaction, first, second);
	const results = await Promise.allSettled([
		f.auth.exchange('mainnet', signed),
		f.auth.exchange('mainnet', signed)
	]);
	expect(results.filter((row) => row.status === 'fulfilled')).toHaveLength(1);
	expect(f.proofs.size).toBe(1);
	const result = results.find((row) => row.status === 'fulfilled');
	if (result?.status !== 'fulfilled') throw new Error('Missing session');
	f.setAuthority({
		...f.authority,
		signers: [{ key: first.publicKey(), weight: 1, type: 'ed25519_public_key' }]
	});
	await expect(
		f.auth.applicant(request(result.value.token))
	).rejects.toMatchObject({ status: 401 });
});
it('ignores ambient credentials, rejects a foreign Origin and disallows cross-account control', async () => {
	const f = fixture();
	expect(await f.auth.applicant(request())).toBeNull();
	const challenge = await f.auth.challenge('mainnet', address);
	const session = await f.auth.exchange(
		'mainnet',
		sign(challenge.transaction, first, second)
	);
	await expect(
		f.auth.applicant(request(session.token, 'https://foreign.example.org'))
	).rejects.toMatchObject({ status: 403 });
	expect(
		await f.auth.control(
			request(session.token),
			{ network: 'testnet', address },
			principal('testnet', address)
		)
	).toBeNull();
	await f.auth.logout(request(session.token));
	expect(await f.auth.applicant(request(session.token))).toBeNull();
});
it('normalizes the actual DELETE RETURNING driver result before creating one session', async () => {
	const hash = 'a'.repeat(64);
	const query = jest.fn(async (sql: string) =>
		sql.startsWith('DELETE')
			? [[{ hash }], 1]
			: sql.startsWith('SELECT count')
				? [{ count: 0 }]
				: []
	);
	const database = {
		transaction: async (work: (manager: EntityManager) => Promise<unknown>) =>
			work({ query } as unknown as EntityManager)
	} as unknown as DataSource;
	const store = new TypeOrmVerificationAuthStore(database);
	const proof: AuthenticatedProof = {
		hash,
		network: 'mainnet',
		address,
		expiresAt: new Date(Date.now() + 60_000).toISOString(),
		authenticatedAt: new Date().toISOString(),
		proofExpiresAt: new Date(Date.now() + 86400000).toISOString(),
		tokenHash: 'b'.repeat(64),
		provedSigners: [address]
	};
	expect(await store.consume(proof)).toBe(true);
	expect(
		query.mock.calls.filter((call) => call[0].startsWith('INSERT'))
	).toHaveLength(1);
});
it('permits only an authenticated allowlisted reviewer to recheck a stored applicant proof against current authority', async () => {
	const f = fixture();
	const ownerChallenge = await f.auth.challenge('mainnet', address);
	const owner = await f.auth.exchange(
		'mainnet',
		sign(ownerChallenge.transaction, first, second)
	);
	const control = await f.auth.control(
		request(owner.token),
		{ network: 'mainnet', address },
		owner.subjectId
	);
	const reviewerAddress = second.publicKey();
	const ownerAuthority = f.authority;
	const reviewerAuthority = authorityFromRecord(
		{
			account_id: reviewerAddress,
			last_modified_ledger: 100,
			thresholds: { low_threshold: 1, med_threshold: 1, high_threshold: 1 },
			signers: [{ key: reviewerAddress, weight: 1, type: 'ed25519_public_key' }]
		},
		'mainnet',
		reviewerAddress,
		100,
		new Date(ownerAuthority.observedAt)
	);
	f.read.mockImplementation(async (_network, key) =>
		key === address ? ownerAuthority : reviewerAuthority
	);
	const challenge = await f.auth.challenge('mainnet', reviewerAddress);
	const reviewerSession = await f.auth.exchange(
		'mainnet',
		sign(challenge.transaction, second)
	);
	expect(
		await f.auth.control(
			request(reviewerSession.token),
			{ network: 'mainnet', address, control: control! },
			owner.subjectId
		)
	).toBeNull();
	f.reviewers.add(reviewerSession.subjectId);
	expect(
		await f.auth.control(
			request(reviewerSession.token),
			{ network: 'mainnet', address, control: control! },
			owner.subjectId
		)
	).toMatchObject({ subjectId: owner.subjectId, address });
	expect(
		await f.auth.control(
			request(reviewerSession.token),
			{ network: 'mainnet', address },
			owner.subjectId
		)
	).toBeNull();
	f.read.mockImplementation(async (_network, key) =>
		key === address ? { ...ownerAuthority, threshold: 3 } : reviewerAuthority
	);
	expect(
		await f.auth.control(
			request(reviewerSession.token),
			{ network: 'mainnet', address, control: control! },
			owner.subjectId
		)
	).toBeNull();
});
