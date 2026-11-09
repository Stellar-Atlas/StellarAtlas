import {
	createCipheriv,
	createDecipheriv,
	hkdfSync,
	randomBytes
} from 'node:crypto';
import type { DataSource, EntityManager } from 'typeorm';
import type { DeveloperAuthStore } from './DeveloperAuthRouter.js';
import { verificationReturnedRows } from './VerificationSqlRows.js';

type GithubFlow = Parameters<DeveloperAuthStore['issueFlow']>[0];
type DeveloperSession = Parameters<DeveloperAuthStore['createSession']>[1];

export class TypeOrmDeveloperAuthStore implements DeveloperAuthStore {
	private inFlight = 0;
	private readonly verifierKey: Buffer;

	constructor(
		private readonly database: DataSource,
		githubClientSecret: string
	) {
		this.verifierKey = Buffer.from(
			hkdfSync(
				'sha256',
				githubClientSecret,
				'',
				'atlas-developer-oauth-pkce-v1',
				32
			)
		);
	}

	async assertReady(): Promise<void> {
		await this.transaction(async (manager) => {
			const [row] = await manager.query<{ ready: boolean }[]>(`
				SELECT
					has_table_privilege('atlas_developer_github_flow', 'SELECT')
					AND has_table_privilege('atlas_developer_github_flow', 'INSERT')
					AND has_table_privilege('atlas_developer_github_flow', 'DELETE')
					AND has_table_privilege('atlas_developer_github_budget', 'SELECT')
					AND has_table_privilege('atlas_developer_github_budget', 'INSERT')
					AND has_table_privilege('atlas_developer_github_budget', 'UPDATE')
					AND has_table_privilege('atlas_developer_github_principal', 'SELECT')
					AND has_table_privilege('atlas_developer_github_principal', 'INSERT')
					AND has_table_privilege('atlas_developer_github_session', 'SELECT')
					AND has_table_privilege('atlas_developer_github_session', 'INSERT')
					AND has_table_privilege('atlas_developer_github_session', 'DELETE')
					AS ready
			`);
			if (row?.ready !== true)
				throw new Error('Developer authentication storage is unavailable');
		});
	}

	async issueFlow(flow: GithubFlow): Promise<boolean> {
		return this.transaction(async (manager) => {
			// The singleton row serializes admission across workers. Consuming a
			// state does not refund the start against the current minute.
			const budget = await manager.query<{ starts: number }[]>(`
				INSERT INTO atlas_developer_github_budget AS budget(singleton,window_start,starts)
				VALUES (true,statement_timestamp(),1)
				ON CONFLICT (singleton) DO UPDATE SET
					window_start=CASE WHEN budget.window_start<=statement_timestamp()-interval '1 minute'
						THEN statement_timestamp() ELSE budget.window_start END,
					starts=CASE WHEN budget.window_start<=statement_timestamp()-interval '1 minute'
						THEN 1 ELSE budget.starts+1 END
				WHERE budget.window_start<=statement_timestamp()-interval '1 minute' OR budget.starts<30
				RETURNING starts
			`);
			if (!budget.length) return false;
			await manager.query(`
				DELETE FROM atlas_developer_github_flow WHERE state_hash IN (
					SELECT state_hash FROM atlas_developer_github_flow
					WHERE expires_at<=clock_timestamp() ORDER BY expires_at LIMIT 200
				)
			`);
			const [row] = await manager.query<{ full: boolean }[]>(`
				SELECT count(*) >= 500 AS full FROM atlas_developer_github_flow
			`);
			if (row?.full !== false) return false;
			const inserted = await manager.query<{ state_hash: string }[]>(
				`
				INSERT INTO atlas_developer_github_flow(state_hash,browser_hash,sealed_verifier,expires_at)
				SELECT $1,$2,$3,LEAST($4::timestamptz,clock_timestamp()+interval '10 minutes')
				WHERE $4::timestamptz>clock_timestamp()
				RETURNING state_hash
			`,
				[
					flow.stateHash,
					flow.browserHash,
					this.sealVerifier(flow),
					new Date(flow.expiresAt)
				]
			);
			return inserted[0]?.state_hash === flow.stateHash;
		});
	}

	async consumeFlow(
		stateHash: string,
		browserHash: string
	): Promise<GithubFlow | null> {
		const row = await this.transaction(async (manager) => {
			const result = await manager.query<unknown>(
				`
				DELETE FROM atlas_developer_github_flow
				WHERE state_hash=$1 AND browser_hash=$2 AND expires_at>clock_timestamp()
				RETURNING state_hash AS "stateHash", browser_hash AS "browserHash", sealed_verifier,
					(extract(epoch FROM expires_at)*1000)::double precision AS "expiresAt"
			`,
				[stateHash, browserHash]
			);
			return verificationReturnedRows(result)[0];
		});
		if (!row) return null;
		if (
			row.stateHash !== stateHash ||
			row.browserHash !== browserHash ||
			typeof row.sealed_verifier !== 'string' ||
			typeof row.expiresAt !== 'number'
		)
			throw new Error('Invalid developer OAuth state');
		return {
			stateHash,
			browserHash,
			expiresAt: row.expiresAt,
			verifier: this.openVerifier(stateHash, browserHash, row.sealed_verifier)
		};
	}

	async createSession(
		tokenHash: string,
		session: DeveloperSession
	): Promise<void> {
		await this.transaction(async (manager) => {
			await manager.query(
				"SELECT pg_advisory_xact_lock(hashtextextended('atlas-developer-github-session',0))"
			);
			await manager.query(`
				DELETE FROM atlas_developer_github_session WHERE token_hash IN (
					SELECT token_hash FROM atlas_developer_github_session
					WHERE expires_at<=clock_timestamp() ORDER BY expires_at LIMIT 200
				)
			`);
			const [row] = await manager.query<{ full: boolean }[]>(
				`
				SELECT count(*)>=10000 OR
					count(*) FILTER (WHERE user_id=$1 AND expires_at>clock_timestamp())>=8 AS full
				FROM atlas_developer_github_session
			`,
				[session.providerUserId]
			);
			if (row?.full !== false)
				throw new Error('Developer session capacity exhausted');
			await manager.query(
				`
				INSERT INTO atlas_developer_github_principal(user_id) VALUES ($1)
				ON CONFLICT (user_id) DO NOTHING
			`,
				[session.providerUserId]
			);
			const rows = await manager.query<{ token_hash: string }[]>(
				`
				INSERT INTO atlas_developer_github_session(token_hash,user_id,expires_at)
				SELECT $1,$2,LEAST($3::timestamptz,clock_timestamp()+interval '20 minutes')
				WHERE $3::timestamptz>clock_timestamp()
				RETURNING token_hash
			`,
				[tokenHash, session.providerUserId, new Date(session.expiresAt)]
			);
			if (rows[0]?.token_hash !== tokenHash)
				throw new Error('Invalid developer session expiry');
		});
	}

	async session(tokenHash: string): Promise<DeveloperSession | null> {
		return this.transaction(async (manager) => {
			const rows = await manager.query<DeveloperSession[]>(
				`
				SELECT user_id AS "providerUserId",
					(extract(epoch FROM expires_at)*1000)::double precision AS "expiresAt"
				FROM atlas_developer_github_session
				WHERE token_hash=$1 AND expires_at>clock_timestamp()
			`,
				[tokenHash]
			);
			return rows[0] ?? null;
		});
	}

	async revokeSession(tokenHash: string): Promise<void> {
		await this.transaction(async (manager) => {
			await manager.query(
				'DELETE FROM atlas_developer_github_session WHERE token_hash=$1',
				[tokenHash]
			);
		});
	}

	private async transaction<T>(
		run: (manager: EntityManager) => Promise<T>
	): Promise<T> {
		// Include time spent acquiring a pool connection in the per-worker cap.
		if (this.inFlight >= 4)
			throw new Error('Developer authentication storage busy');
		this.inFlight++;
		try {
			return await this.database.transaction(async (manager) => {
				const [mode] = await manager.query<{ transaction_read_only: string }[]>(
					'SHOW transaction_read_only'
				);
				if (mode?.transaction_read_only !== 'off')
					throw new Error(
						'Developer authentication requires a read-write transaction'
					);
				await manager.query("SET LOCAL lock_timeout='1s'");
				await manager.query("SET LOCAL statement_timeout='2s'");
				return run(manager);
			});
		} finally {
			this.inFlight--;
		}
	}

	private sealVerifier(flow: GithubFlow): string {
		const nonce = randomBytes(12);
		const cipher = createCipheriv('aes-256-gcm', this.verifierKey, nonce);
		cipher.setAAD(Buffer.from(flow.stateHash + flow.browserHash));
		const ciphertext = Buffer.concat([
			cipher.update(flow.verifier, 'ascii'),
			cipher.final()
		]);
		return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]).toString(
			'base64url'
		);
	}

	private openVerifier(
		stateHash: string,
		browserHash: string,
		value: string
	): string {
		const bytes = Buffer.from(value, 'base64url');
		if (bytes.length !== 71)
			throw new Error('Invalid sealed developer verifier');
		const decipher = createDecipheriv(
			'aes-256-gcm',
			this.verifierKey,
			bytes.subarray(0, 12)
		);
		decipher.setAAD(Buffer.from(stateHash + browserHash));
		decipher.setAuthTag(bytes.subarray(12, 28));
		const verifier = Buffer.concat([
			decipher.update(bytes.subarray(28)),
			decipher.final()
		]).toString('ascii');
		if (!/^[A-Za-z0-9_-]{43}$/.test(verifier))
			throw new Error('Invalid developer verifier');
		return verifier;
	}
}
