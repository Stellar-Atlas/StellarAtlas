import type { DataSource, EntityManager } from 'typeorm';
import { VerificationError, type Network } from './VerificationApplication.js';
import { verificationReturnedRows } from './VerificationSqlRows.js';

export interface IssuedChallenge {
	readonly hash: string;
	readonly network: Network;
	readonly address: string;
	readonly expiresAt: string;
}
export interface AuthenticatedProof extends IssuedChallenge {
	readonly provedSigners: readonly string[];
	readonly authenticatedAt: string;
	readonly proofExpiresAt: string;
	readonly tokenHash: string;
}
export interface VerificationAuthStore {
	issue(challenge: IssuedChallenge): Promise<void>;
	challenge(hash: string): Promise<IssuedChallenge | null>;
	consume(proof: AuthenticatedProof): Promise<boolean>;
	session(tokenHash: string): Promise<AuthenticatedProof | null>;
	proof(hash: string): Promise<AuthenticatedProof | null>;
	revoke(tokenHash: string): Promise<void>;
	admitAuthorityRead(): Promise<void>;
}
export class TypeOrmVerificationAuthStore implements VerificationAuthStore {
	constructor(private readonly database: DataSource) {}
	async issue(challenge: IssuedChallenge): Promise<void> {
		await this.database.transaction(async (manager) => {
			await this.lock(manager);
			await manager.query(`DELETE FROM atlas_verification_challenge WHERE hash IN
				(SELECT hash FROM atlas_verification_challenge WHERE expires_at<=clock_timestamp() ORDER BY expires_at LIMIT 200)`);
			await manager.query(`DELETE FROM atlas_verification_auth WHERE hash IN
				(SELECT hash FROM atlas_verification_auth WHERE proof_expires_at<=clock_timestamp() ORDER BY proof_expires_at LIMIT 200)`);
			const [counts] = await manager.query<
				{ total: number; recent: number; account_recent: number }[]
			>(
				`SELECT count(*)::int AS total,
				count(*) FILTER(WHERE created_at > clock_timestamp()-interval '1 minute')::int AS recent,
				count(*) FILTER(WHERE network=$1 AND address=$2 AND created_at > clock_timestamp()-interval '1 minute')::int AS account_recent
				FROM atlas_verification_challenge`,
				[challenge.network, challenge.address]
			);
			const [proofs] = await manager.query<{ count: number }[]>(
				'SELECT count(*)::int AS count FROM atlas_verification_auth'
			);
			if (
				!counts ||
				counts.total >= 500 ||
				counts.recent >= 60 ||
				counts.account_recent >= 3 ||
				!proofs ||
				proofs.count >= 10000
			)
				throw new VerificationError(
					429,
					'Authentication admission limit reached'
				);
			await manager.query(
				`INSERT INTO atlas_verification_challenge(hash,network,address,expires_at)
				VALUES($1,$2,$3,$4)`,
				[
					challenge.hash,
					challenge.network,
					challenge.address,
					challenge.expiresAt
				]
			);
		});
	}
	async challenge(hash: string): Promise<IssuedChallenge | null> {
		const rows = await this.database.query<IssuedChallenge[]>(
			`SELECT hash,network,address,expires_at::text AS "expiresAt"
			FROM atlas_verification_challenge WHERE hash=$1 AND expires_at>clock_timestamp()`,
			[hash]
		);
		return rows[0] ?? null;
	}
	async consume(proof: AuthenticatedProof): Promise<boolean> {
		return this.database.transaction(async (manager) => {
			await this.lock(manager);
			const [count] = await manager.query<{ count: number }[]>(
				'SELECT count(*)::int AS count FROM atlas_verification_auth'
			);
			if (!count || count.count >= 10000)
				throw new VerificationError(
					429,
					'Authentication admission limit reached'
				);
			const result = await manager.query<unknown>(
				`DELETE FROM atlas_verification_challenge
				WHERE hash=$1 AND network=$2 AND address=$3 AND expires_at>clock_timestamp() RETURNING hash`,
				[proof.hash, proof.network, proof.address]
			);
			const rows = verificationReturnedRows(result);
			if (rows.length !== 1 || rows[0]?.hash !== proof.hash) return false;
			await manager.query(
				`INSERT INTO atlas_verification_auth
				(hash,network,address,expires_at,proof_expires_at,token_hash,payload) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)`,
				[
					proof.hash,
					proof.network,
					proof.address,
					proof.expiresAt,
					proof.proofExpiresAt,
					proof.tokenHash,
					JSON.stringify(proof)
				]
			);
			return true;
		});
	}
	async session(tokenHash: string): Promise<AuthenticatedProof | null> {
		const rows = await this.database.query<{ payload: AuthenticatedProof }[]>(
			`SELECT payload FROM atlas_verification_auth
			WHERE token_hash=$1 AND expires_at>clock_timestamp()`,
			[tokenHash]
		);
		return rows[0]?.payload ?? null;
	}
	async proof(hash: string): Promise<AuthenticatedProof | null> {
		const rows = await this.database.query<{ payload: AuthenticatedProof }[]>(
			`SELECT payload FROM atlas_verification_auth
			WHERE hash=$1 AND proof_expires_at>clock_timestamp()`,
			[hash]
		);
		return rows[0]?.payload ?? null;
	}
	async revoke(tokenHash: string): Promise<void> {
		await this.database.query(
			'UPDATE atlas_verification_auth SET expires_at=clock_timestamp() WHERE token_hash=$1',
			[tokenHash]
		);
	}
	async admitAuthorityRead(): Promise<void> {
		const rows = await this.database.query<
			{ count: number }[]
		>(`INSERT INTO atlas_verification_auth_budget(id,window_start,count)
			VALUES('authority',clock_timestamp(),1) ON CONFLICT(id) DO UPDATE SET
			count=CASE WHEN atlas_verification_auth_budget.window_start<=clock_timestamp()-interval '1 minute' THEN 1 ELSE LEAST(7,atlas_verification_auth_budget.count+1) END,
			window_start=CASE WHEN atlas_verification_auth_budget.window_start<=clock_timestamp()-interval '1 minute' THEN clock_timestamp() ELSE atlas_verification_auth_budget.window_start END
			RETURNING count`);
		if (!rows[0] || rows[0].count > 6)
			throw new VerificationError(
				429,
				'Account-authority request budget reached'
			);
	}
	private async lock(manager: EntityManager): Promise<void> {
		await manager.query("SET LOCAL lock_timeout='2s'");
		await manager.query("SET LOCAL statement_timeout='5s'");
		await manager.query(
			"SELECT pg_advisory_xact_lock(hashtextextended('atlas-verification-auth',0))"
		);
	}
}
