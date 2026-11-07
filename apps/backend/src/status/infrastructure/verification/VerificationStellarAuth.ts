import { createHash, randomBytes } from 'node:crypto';
import { Keypair, WebAuth } from '@stellar/stellar-sdk';
import type { Request } from 'express';
import {
	passphrase,
	type AccountAuthority,
	type AuthorityReader
} from './VerificationAuthority.js';
import {
	VerificationError,
	target,
	type ControlEvidence,
	type Network,
	type Submission
} from './VerificationApplication.js';
import type { VerificationBoundary } from './VerificationRouter.js';
import type {
	AuthenticatedProof,
	VerificationAuthStore
} from './VerificationAuthStore.js';

export const principal = (network: Network, address: string): string =>
	`stellar:${network}:${address}`;
export const tokenHash = (token: string): string =>
	createHash('sha256').update(token).digest('hex');
export interface StellarAuthConfig {
	readonly origin: string;
	readonly homeDomain: string;
	readonly server: Keypair;
	readonly networks: ReadonlySet<Network>;
	readonly reviewers: ReadonlySet<string>;
}
interface Session {
	readonly proof: AuthenticatedProof;
	readonly authority: AccountAuthority;
	readonly subjectId: string;
}
/** SEP-10 challenge primitives with Atlas-local opaque bearer sessions (not a JWT/SEP-10 discovery endpoint). */
export class VerificationStellarAuth implements VerificationBoundary {
	private readonly requests = new WeakMap<Request, Promise<Session | null>>();
	constructor(
		readonly config: StellarAuthConfig,
		private readonly store: VerificationAuthStore,
		private readonly authority: AuthorityReader,
		private readonly now: () => Date = () => new Date()
	) {}
	checkOrigin(request: Request): void {
		const origin = request.get('Origin');
		if (origin !== undefined && origin !== this.config.origin)
			throw new VerificationError(403, 'Verification origin mismatch');
	}
	async challenge(network: unknown, address: unknown) {
		const account = target(network, address);
		if (
			!this.config.networks.has(account.network) ||
			account.address === this.config.server.publicKey()
		)
			throw new VerificationError(
				403,
				'This account or network is unsupported'
			);
		const transaction = WebAuth.buildChallengeTx(
			this.config.server,
			account.address,
			this.config.homeDomain,
			300,
			passphrase(account.network),
			new URL(this.config.origin).hostname
		);
		const details = this.read(transaction, account.network);
		const hash = Buffer.from(details.tx.hash()).toString('hex');
		const expiresAt = new Date(
			Number(details.tx.timeBounds!.maxTime) * 1000
		).toISOString();
		await this.store.issue({ ...account, hash, expiresAt });
		return {
			transaction,
			network: account.network,
			networkPassphrase: passphrase(account.network),
			homeDomain: this.config.homeDomain,
			webAuthDomain: new URL(this.config.origin).hostname,
			serverAccount: this.config.server.publicKey(),
			expiresAt
		};
	}
	async exchange(network: unknown, transaction: unknown) {
		if (
			(network !== 'mainnet' && network !== 'testnet') ||
			!this.config.networks.has(network)
		)
			throw new VerificationError(400, 'Unsupported authentication network');
		const details = this.read(transaction, network);
		const address = details.clientAccountID;
		target(network, address);
		const hash = Buffer.from(details.tx.hash()).toString('hex');
		const issued = await this.store.challenge(hash);
		if (
			!issued ||
			issued.network !== network ||
			issued.address !== address ||
			Date.parse(issued.expiresAt) <= this.now().getTime()
		)
			throw new VerificationError(
				401,
				'Challenge expired, unknown or already used'
			);
		const authority = await this.readAuthority(network, address);
		if (
			authority.signers.some(
				(signer) => signer.key === this.config.server.publicKey()
			)
		)
			throw new VerificationError(
				403,
				'The authentication server cannot be an account signer'
			);
		let provedSigners: string[];
		try {
			provedSigners = WebAuth.verifyChallengeTxThreshold(
				String(transaction),
				this.config.server.publicKey(),
				passphrase(network),
				authority.threshold,
				authority.signers,
				this.config.homeDomain,
				new URL(this.config.origin).hostname
			);
		} catch {
			throw new VerificationError(
				401,
				'Account signatures do not satisfy current authority'
			);
		}
		const token = randomBytes(32).toString('base64url');
		const authenticatedAt = this.now().toISOString();
		const proof: AuthenticatedProof = {
			...issued,
			provedSigners,
			authenticatedAt,
			proofExpiresAt: new Date(
				this.now().getTime() + 24 * 60 * 60_000
			).toISOString(),
			tokenHash: tokenHash(token)
		};
		if (!(await this.store.consume(proof)))
			throw new VerificationError(401, 'Challenge already used');
		return {
			token,
			tokenType: 'Bearer',
			expiresAt: proof.expiresAt,
			network,
			address,
			subjectId: principal(network, address)
		};
	}
	async applicant(request: Request) {
		const session = await this.session(request);
		return session ? { subjectId: session.subjectId } : null;
	}
	async reviewer(request: Request) {
		const session = await this.session(request);
		return session && this.config.reviewers.has(session.subjectId)
			? { subjectId: session.subjectId, role: 'identity-reviewer' as const }
			: null;
	}
	async control(
		request: Request,
		input: Pick<Submission, 'network' | 'address'> & {
			readonly control?: ControlEvidence;
		},
		subjectId: string
	): Promise<ControlEvidence | null> {
		const session = await this.session(request);
		if (!session || subjectId !== principal(input.network, input.address))
			return null;
		let proof = session.proof,
			authority = session.authority;
		if (session.subjectId !== subjectId) {
			if (!this.config.reviewers.has(session.subjectId)) return null;
			const reference = input.control?.reference;
			if (!reference || !/^sep10:[0-9a-f]{64}$/.test(reference)) return null;
			const retained = await this.store.proof(reference.slice(6));
			if (
				!retained ||
				retained.network !== input.network ||
				retained.address !== input.address ||
				Date.parse(retained.proofExpiresAt) <= this.now().getTime()
			)
				return null;
			proof = retained;
			authority = await this.readAuthority(input.network, input.address);
		}
		if (
			proof.network !== input.network ||
			proof.address !== input.address ||
			!this.sufficient(proof, authority)
		)
			return null;
		return {
			subjectId,
			network: input.network,
			address: input.address,
			method: 'stellar-account-authority',
			verifiedAt: authority.observedAt,
			reference: 'sep10:' + proof.hash
		};
	}
	async logout(request: Request): Promise<void> {
		this.checkOrigin(request);
		const token = this.bearer(request);
		if (token) await this.store.revoke(tokenHash(token));
	}
	private session(request: Request): Promise<Session | null> {
		let pending = this.requests.get(request);
		if (pending) return pending;
		pending = (async () => {
			this.checkOrigin(request);
			const token = this.bearer(request);
			if (!token) return null;
			const proof = await this.store.session(tokenHash(token));
			if (!proof || Date.parse(proof.expiresAt) <= this.now().getTime())
				return null;
			const authority = await this.readAuthority(proof.network, proof.address);
			if (!this.sufficient(proof, authority))
				throw new VerificationError(
					401,
					'Account authority changed; authenticate again'
				);
			return {
				proof,
				authority,
				subjectId: principal(proof.network, proof.address)
			};
		})();
		this.requests.set(request, pending);
		return pending;
	}
	private bearer(request: Request): string | null {
		const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(
			request.get('Authorization') ?? ''
		);
		return match?.[1] ?? null;
	}
	private sufficient(
		proof: AuthenticatedProof,
		authority: AccountAuthority
	): boolean {
		const signers = new Set(proof.provedSigners);
		return (
			!signers.has(this.config.server.publicKey()) &&
			authority.signers
				.filter((signer) => signers.has(signer.key))
				.reduce((sum, signer) => sum + signer.weight, 0) >= authority.threshold
		);
	}
	private async readAuthority(
		network: Network,
		address: string
	): Promise<AccountAuthority> {
		if (!this.config.networks.has(network))
			throw new VerificationError(403, 'Unsupported authentication network');
		await this.store.admitAuthorityRead();
		const authority = await this.authority(network, address);
		const age = this.now().getTime() - Date.parse(authority.observedAt);
		if (
			authority.network !== network ||
			authority.address !== address ||
			!Number.isFinite(age) ||
			age < 0 ||
			age > 30_000 ||
			authority.signers.some(
				(signer) => signer.key === this.config.server.publicKey()
			)
		)
			throw new VerificationError(
				503,
				'Current account authority is unavailable'
			);
		return authority;
	}
	private read(transaction: unknown, network: Network) {
		if (
			typeof transaction !== 'string' ||
			transaction.length > 16384 ||
			!/^[A-Za-z0-9+/]+={0,2}$/.test(transaction)
		)
			throw new VerificationError(400, 'Supply a bounded signed challenge');
		try {
			const details = WebAuth.readChallengeTx(
				transaction,
				this.config.server.publicKey(),
				passphrase(network),
				this.config.homeDomain,
				new URL(this.config.origin).hostname
			);
			const bounds = details.tx.timeBounds;
			const now = Math.floor(this.now().getTime() / 1000);
			if (
				!bounds ||
				Number(bounds.minTime) > now ||
				Number(bounds.maxTime) <= now ||
				Number(bounds.maxTime) - Number(bounds.minTime) !== 300 ||
				details.memo !== null ||
				details.tx.operations.length !== 2
			)
				throw new Error();
			const second = details.tx.operations[1]!;
			if (
				second.type !== 'manageData' ||
				second.name !== 'web_auth_domain' ||
				!second.value ||
				Buffer.from(second.value).toString('utf8') !==
					new URL(this.config.origin).hostname
			)
				throw new Error();
			return details;
		} catch {
			throw new VerificationError(
				401,
				'Invalid or expired Atlas authentication challenge'
			);
		}
	}
}
